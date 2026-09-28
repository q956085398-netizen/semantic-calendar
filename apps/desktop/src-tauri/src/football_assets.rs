//! Only logical IDs from the shipped manifest can request public PNG resources.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{collections::BTreeMap, time::Duration};

const MANIFEST: &str = include_str!("../../src/providers/football/asset-manifest.json");
const MAX_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    assets: BTreeMap<String, String>,
    failed_refs: Vec<String>,
}

fn valid_png(bytes: &[u8]) -> bool {
    if bytes.len() < 33
        || bytes.len() > MAX_BYTES
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    (1..=2048).contains(&width) && (1..=2048).contains(&height)
}

pub async fn download(refs: Vec<String>) -> Result<DownloadResult, String> {
    if refs.len() > 64 {
        return Err("一次最多请求 64 个图标".into());
    }
    let manifest: BTreeMap<String, String> =
        serde_json::from_str(MANIFEST).map_err(|_| "图标目录不可用")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化图标下载")?;
    let mut result = DownloadResult {
        assets: BTreeMap::new(),
        failed_refs: Vec::new(),
    };
    let mut pending = tokio::task::JoinSet::new();
    // Four downloads at a time, with fixed trusted URLs. No imported calendar text leaves the app.
    for batch in refs.chunks(4) {
        for reference in batch {
            let Some(url) = manifest.get(reference) else {
                result.failed_refs.push(reference.clone());
                continue;
            };
            let url = url.clone();
            let reference = reference.clone();
            let client = client.clone();
            pending.spawn(async move {
                let fetched = async {
                    let mut response =
                        client.get(url).send().await.ok()?.error_for_status().ok()?;
                    if response
                        .content_length()
                        .is_some_and(|n| n > MAX_BYTES as u64)
                    {
                        return None;
                    }
                    let mut bytes = Vec::new();
                    while let Some(chunk) = response.chunk().await.ok()? {
                        if bytes.len() + chunk.len() > MAX_BYTES {
                            return None;
                        }
                        bytes.extend_from_slice(&chunk);
                    }
                    valid_png(&bytes)
                        .then(|| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
                }
                .await;
                (reference, fetched)
            });
        }
        while let Some(completed) = pending.join_next().await {
            let (reference, data) = completed.map_err(|_| "图标下载任务失败")?;
            match data {
                Some(data) => {
                    result.assets.insert(reference, data);
                }
                None => result.failed_refs.push(reference),
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_html_empty_oversized_and_invalid_dimensions() {
        assert!(!valid_png(b"<html>error</html>"));
        let mut bytes = vec![0; 33];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&150_u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&150_u32.to_be_bytes());
        assert!(valid_png(&bytes));
        bytes[16..20].copy_from_slice(&3000_u32.to_be_bytes());
        assert!(!valid_png(&bytes));
        assert!(!valid_png(&vec![0; MAX_BYTES + 1]));
    }
    #[test]
    fn manifest_only_contains_trusted_https_pngs() {
        let manifest: BTreeMap<String, String> = serde_json::from_str(MANIFEST).unwrap();
        for (reference, url) in manifest {
            assert!(
                reference.starts_with("crest.team.") || reference.starts_with("logo.competition.")
            );
            let parsed = reqwest::Url::parse(&url).unwrap();
            assert_eq!(parsed.scheme(), "https");
            assert!([
                "raw.githubusercontent.com",
                "img.uefa.com",
                "media.api-sports.io"
            ]
            .contains(&parsed.host_str().unwrap()));
            assert!(parsed.path().ends_with(".png"));
        }
    }
    #[test]
    #[ignore = "explicit live public-resource verification"]
    fn live_public_resources_use_production_downloader() {
        let result = tauri::async_runtime::block_on(download(vec![
            "crest.team.sabah".into(),
            "crest.team.psv".into(),
            "logo.competition.champions-league".into(),
            "unknown-ref".into(),
        ]))
        .unwrap();
        assert_eq!(
            result.assets.len(),
            3,
            "failed references: {:?}",
            result.failed_refs
        );
        assert_eq!(result.failed_refs, vec!["unknown-ref"]);
        for data in result.assets.values() {
            assert!(data.starts_with("data:image/png;base64,"));
        }
        println!("Production downloader: 3 PNGs received; unknown ref rejected");
    }
}
