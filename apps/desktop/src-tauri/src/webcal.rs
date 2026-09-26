//! WebCal / ICS 订阅抓取（SC-007 / SRC-002）。
//!
//! 为什么放在 Rust 侧：webview 里的 fetch 受同源策略限制，绝大多数 ICS
//! 服务端不返回 CORS 头，订阅会直接失败；同时敏感 token 也不该进入
//! webview 的网络栈。
//!
//! 可靠性约定（app-spec §12 / §13 / §14）：
//! - 请求有连接与总超时；
//! - 非 2xx 不读正文，按状态码交给前端降级；
//! - 错误文案不包含请求地址，也不写日志——地址可能带服务端签发的 token。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use reqwest::header::{HeaderName, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use reqwest::{Client, StatusCode, Url};
use tokio::sync::oneshot;

/// 连接超时与总超时。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);

/// 响应体上限：日历文件远小于此，超出视为异常响应而不是读进内存。
const MAX_BODY_BYTES: u64 = 20 * 1024 * 1024;
pub const REQUEST_CANCELLED: &str = "订阅请求已取消";

struct RegisteredRequest {
    cancel: Option<oneshot::Sender<()>>,
    receiver: Option<oneshot::Receiver<()>>,
    started: bool,
}

/// 单请求取消登记表。请求 id 由前端为每次 GET 生成，避免取消一个来源时
/// 影响另一个同时进行的订阅请求。
#[derive(Default)]
pub struct WebcalRequestRegistry(Mutex<HashMap<String, RegisteredRequest>>);

impl WebcalRequestRegistry {
    pub fn register(&self, request_id: String) -> Result<(), String> {
        let (cancel, receiver) = oneshot::channel();
        let mut requests = self.0.lock().map_err(|_| "无法登记订阅请求".to_string())?;
        if requests.contains_key(&request_id) {
            return Err("订阅请求标识重复".to_string());
        }
        requests.insert(
            request_id,
            RegisteredRequest {
                cancel: Some(cancel),
                receiver: Some(receiver),
                started: false,
            },
        );
        Ok(())
    }

    pub fn cancel(&self, request_id: &str) {
        let Ok(mut requests) = self.0.lock() else {
            return;
        };
        if let Some(request) = requests.get_mut(request_id) {
            if let Some(cancel) = request.cancel.take() {
                let _ = cancel.send(());
            }
            // 若网络命令尚未开始，取消已完成，直接释放登记和 receiver。
            if !request.started {
                requests.remove(request_id);
            }
        }
    }

    pub fn start(&self, request_id: &str) -> Result<oneshot::Receiver<()>, String> {
        let mut requests = self.0.lock().map_err(|_| "无法读取订阅请求".to_string())?;
        let request = requests
            .get_mut(request_id)
            .ok_or_else(|| "订阅请求不存在或已取消".to_string())?;
        request.started = true;
        request
            .receiver
            .take()
            .ok_or_else(|| "订阅请求已经开始".to_string())
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut requests) = self.0.lock() {
            requests.remove(request_id);
        }
    }
}

/// 进程内复用一个客户端，保留连接池，避免每次刷新重建 TLS 会话。
static CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .expect("构建 HTTP 客户端失败")
});

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcalFetchResponse {
    pub status: u16,
    /// 304：本地缓存仍然有效，body 为空。
    pub not_modified: bool,
    pub body: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

/// 只允许 http / https；webcal:// 已在前端归一化为 https://。
fn validate_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|_| "订阅地址无法解析".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("不支持的订阅协议：{other}")),
    }
}

fn header_value(response: &reqwest::Response, name: HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

/// reqwest 的错误文案会带上完整 URL（可能含 token），只按错误类别描述。
fn describe_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "网络请求超时".to_string()
    } else if error.is_connect() {
        "无法连接到订阅地址".to_string()
    } else if error.is_redirect() {
        "订阅地址重定向次数过多".to_string()
    } else if error.is_body() || error.is_decode() {
        "订阅响应读取失败".to_string()
    } else {
        "网络请求失败".to_string()
    }
}

/// 带条件校验值的 GET：有 etag / last_modified 时发出条件请求，
/// 服务端可回 304，从而避免重复下载整份日历（SRC-002 / §12）。
#[cfg(test)]
pub async fn fetch(
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<WebcalFetchResponse, String> {
    fetch_response(url, etag, last_modified).await
}

/// 可取消的条件 GET。select 分支覆盖连接、等待响应头和读取正文；取消后
/// reqwest future 被丢弃，底层请求不会继续占用网络资源。
pub async fn fetch_cancellable(
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
    cancel: oneshot::Receiver<()>,
) -> Result<WebcalFetchResponse, String> {
    tokio::select! {
        biased;
        _ = cancel => Err(REQUEST_CANCELLED.to_string()),
        result = fetch_response(url, etag, last_modified) => result,
    }
}

async fn fetch_response(
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<WebcalFetchResponse, String> {
    let parsed = validate_url(&url)?;

    let mut request = CLIENT.get(parsed);
    if let Some(etag) = etag.filter(|value| !value.is_empty()) {
        request = request.header(IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = last_modified.filter(|value| !value.is_empty()) {
        request = request.header(IF_MODIFIED_SINCE, last_modified);
    }

    let response = request.send().await.map_err(|e| describe_error(&e))?;
    let status = response.status();
    let etag = header_value(&response, ETAG);
    let last_modified = header_value(&response, LAST_MODIFIED);

    if status == StatusCode::NOT_MODIFIED {
        return Ok(WebcalFetchResponse {
            status: status.as_u16(),
            not_modified: true,
            body: None,
            etag,
            last_modified,
        });
    }

    if !status.is_success() {
        // 错误页正文没有价值，也避免把无关内容写进缓存。
        return Ok(WebcalFetchResponse {
            status: status.as_u16(),
            not_modified: false,
            body: None,
            etag,
            last_modified,
        });
    }

    if let Some(length) = response.content_length() {
        if length > MAX_BODY_BYTES {
            return Err(format!("订阅内容过大（{length} 字节）"));
        }
    }
    let bytes = response.bytes().await.map_err(|e| describe_error(&e))?;
    if bytes.len() as u64 > MAX_BODY_BYTES {
        return Err(format!("订阅内容过大（{} 字节）", bytes.len()));
    }

    Ok(WebcalFetchResponse {
        status: status.as_u16(),
        not_modified: false,
        // 非 UTF-8 内容按替换字符解码：单个坏字节不应让整份订阅失败。
        body: Some(String::from_utf8_lossy(&bytes).into_owned()),
        etag,
        last_modified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::thread;

    /// 只服务一次请求的本地 HTTP 服务：返回订阅地址与收到的请求文本。
    fn spawn_server(response: Vec<u8>) -> (String, Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("读取本地端口失败");
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 4096];
                let read = stream.read(&mut buffer).unwrap_or(0);
                let _ = sender.send(String::from_utf8_lossy(&buffer[..read]).to_string());
                let _ = stream.write_all(&response);
                let _ = stream.flush();
            }
        });

        (format!("http://{addr}/feed.ics"), receiver)
    }

    fn spawn_waiting_headers_server() -> (String, Receiver<()>, Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("读取本地端口失败");
        let (accepted_tx, accepted_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let _ = accepted_tx.send(());
                if release_rx.recv_timeout(Duration::from_secs(2)).is_ok() {
                    let response = response_bytes(
                        "HTTP/1.1 200 OK",
                        &[],
                        b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
                    );
                    let _ = stream.write_all(&response);
                }
            }
        });
        (format!("http://{addr}/feed.ics"), accepted_rx, release_tx)
    }

    fn spawn_waiting_body_server() -> (String, Receiver<()>, Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("读取本地端口失败");
        let (body_started_tx, body_started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let body = b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
                let split = body.len() / 2;
                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(headers.as_bytes());
                let _ = stream.write_all(&body[..split]);
                let _ = stream.flush();
                let _ = body_started_tx.send(());
                if release_rx.recv_timeout(Duration::from_secs(2)).is_ok() {
                    let _ = stream.write_all(&body[split..]);
                }
            }
        });
        (
            format!("http://{addr}/feed.ics"),
            body_started_rx,
            release_tx,
        )
    }

    fn response_bytes(status_line: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let mut response = format!("{status_line}\r\n");
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        // 明确关闭连接，客户端据此判断响应结束。
        response.push_str("Connection: close\r\n");
        response.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));

        let mut bytes = response.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn returns_body_and_validators_for_ok_response() {
        let (url, requests) = spawn_server(response_bytes(
            "HTTP/1.1 200 OK",
            &[
                ("Content-Type", "text/calendar"),
                ("ETag", "\"v1\""),
                ("Last-Modified", "Wed, 21 Oct 2026 07:28:00 GMT"),
            ],
            b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
        ));

        let result = block_on(fetch(url, None, None)).expect("抓取应成功");

        assert_eq!(result.status, 200);
        assert!(!result.not_modified);
        assert_eq!(
            result.body.as_deref(),
            Some("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
        );
        assert_eq!(result.etag.as_deref(), Some("\"v1\""));
        assert_eq!(
            result.last_modified.as_deref(),
            Some("Wed, 21 Oct 2026 07:28:00 GMT")
        );

        let request = requests.recv().expect("未收到请求");
        assert!(request.starts_with("GET /feed.ics HTTP/1.1"));
        assert!(!request.to_lowercase().contains("if-none-match"));
    }

    #[test]
    fn sends_conditional_headers_and_handles_not_modified() {
        let (url, requests) = spawn_server(response_bytes("HTTP/1.1 304 Not Modified", &[], b""));

        let result = block_on(fetch(
            url,
            Some("\"v1\"".to_string()),
            Some("Wed, 21 Oct 2026 07:28:00 GMT".to_string()),
        ))
        .expect("304 不是错误");

        assert_eq!(result.status, 304);
        assert!(result.not_modified);
        assert!(result.body.is_none());

        let request = requests.recv().expect("未收到请求").to_lowercase();
        assert!(request.contains("if-none-match: \"v1\""));
        assert!(request.contains("if-modified-since: wed, 21 oct 2026 07:28:00 gmt"));
    }

    #[test]
    fn returns_status_without_body_for_error_responses() {
        let (url, _requests) = spawn_server(response_bytes(
            "HTTP/1.1 503 Service Unavailable",
            &[],
            "维护中".as_bytes(),
        ));

        let result = block_on(fetch(url, None, None)).expect("非 2xx 不抛错");

        assert_eq!(result.status, 503);
        assert!(!result.not_modified);
        assert!(result.body.is_none());
    }

    #[test]
    fn decodes_non_utf8_body_with_replacement_characters() {
        let (url, _requests) = spawn_server(response_bytes(
            "HTTP/1.1 200 OK",
            &[],
            &[0x42, 0xff, 0xfe, 0x43],
        ));

        let result = block_on(fetch(url, None, None)).expect("抓取应成功");

        let body = result.body.expect("应有正文");
        assert!(body.starts_with('B'));
        assert!(body.ends_with('C'));
        assert!(body.contains('\u{fffd}'));
    }

    #[test]
    fn rejects_unsupported_scheme_without_touching_network() {
        for url in ["file:///etc/passwd", "ftp://example.com/feed.ics"] {
            let error = block_on(fetch(url.to_string(), None, None)).expect_err("应被拒绝");
            assert!(error.contains("不支持的订阅协议"), "实际：{error}");
        }

        let error = block_on(fetch("not a url".to_string(), None, None)).expect_err("应被拒绝");
        assert_eq!(error, "订阅地址无法解析");
    }

    #[test]
    fn connection_errors_do_not_leak_the_url() {
        // 端口 1 不会有服务在监听；地址里带 token 用于验证错误文案不泄露。
        let error = block_on(fetch(
            "http://127.0.0.1:1/feed.ics?token=SECRET-TOKEN".to_string(),
            None,
            None,
        ))
        .expect_err("连接应失败");

        assert!(
            !error.contains("SECRET-TOKEN"),
            "错误文案泄露了 token：{error}"
        );
        assert!(!error.contains("127.0.0.1"), "错误文案泄露了地址：{error}");
    }

    #[test]
    fn cancels_while_waiting_for_response_headers() {
        let (url, accepted, release) = spawn_waiting_headers_server();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let request = tauri::async_runtime::spawn(fetch_cancellable(url, None, None, cancel_rx));
        accepted
            .recv_timeout(Duration::from_secs(2))
            .expect("服务端未收到请求");

        cancel_tx.send(()).expect("取消信号未送达");
        let error = block_on(request)
            .expect("请求任务不应 panic")
            .expect_err("请求应取消");
        release.send(()).expect("服务端未等待正文");

        assert_eq!(error, REQUEST_CANCELLED);
    }

    #[test]
    fn cancels_while_reading_a_slow_response_body() {
        let (url, body_started, release) = spawn_waiting_body_server();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let request = tauri::async_runtime::spawn(fetch_cancellable(url, None, None, cancel_rx));
        body_started
            .recv_timeout(Duration::from_secs(2))
            .expect("服务端未开始发送正文");

        cancel_tx.send(()).expect("取消信号未送达");
        let error = block_on(request)
            .expect("请求任务不应 panic")
            .expect_err("请求应取消");
        release.send(()).expect("服务端未等待剩余正文");

        assert_eq!(error, REQUEST_CANCELLED);
    }

    #[test]
    fn cancellation_before_fetch_releases_its_registration() {
        let requests = WebcalRequestRegistry::default();
        requests
            .register("request-1".to_string())
            .expect("应登记请求");
        requests.cancel("request-1");
        assert!(requests.start("request-1").is_err());
    }
}
