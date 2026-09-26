//! 本地通知（SC-017 / app-spec §9 NOTIFY-001、§13）。
//!
//! 通知是操作系统能力，因此与 WebCal 抓取、快照读写一样留在 Rust 侧：
//! webview 只通过命令问“现在能不能发”和“发一条通知”，不直接接触插件 API。
//! 什么时候该提醒（提醒时间计算、去重、重启恢复）属于可测试的纯逻辑，留在前端。
//!
//! 权限语义：桌面端没有运行时授权对话框，`tauri-plugin-notification` 在桌面
//! 上恒返回 Granted，是否真正弹出由系统通知设置决定——因此发送失败同样作为
//! 状态回传（kind = "send-failed"），界面据此解释，而不是假装已送达。

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_notification::{NotificationExt, PermissionState};

/// 通知权限状态（§13「通知权限被禁用：在设置中显示状态」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationPermission {
    Granted,
    Denied,
    Prompt,
}

impl From<PermissionState> for NotificationPermission {
    fn from(state: PermissionState) -> Self {
        match state {
            PermissionState::Granted => Self::Granted,
            PermissionState::Denied => Self::Denied,
            // 「需要先询问」与「需要先说明理由」（Android）都还没有权限，
            // 归入 Prompt 让前端去请求，而不是猜成已授权（P-03）。
            PermissionState::Prompt | PermissionState::PromptWithRationale => Self::Prompt,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStatus {
    permission: NotificationPermission,
}

/// 发送失败的结构化原因：前端据此给出可解释状态（§13）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationFailure {
    /// "permission-denied"（没有权限，未尝试发送）或 "send-failed"（系统拒绝 / 出错）。
    kind: &'static str,
    message: String,
}

fn permission_of(app: &AppHandle) -> Result<NotificationPermission, String> {
    app.notification()
        .permission_state()
        .map(|state| state.into())
        .map_err(|error| error.to_string())
}

fn status_of(app: &AppHandle) -> Result<NotificationStatus, String> {
    Ok(NotificationStatus {
        permission: permission_of(app)?,
    })
}

/// 当前权限状态；只读，不触发系统询问。
#[tauri::command]
pub fn notification_status(app: AppHandle) -> Result<NotificationStatus, String> {
    status_of(&app)
}

/// 请求权限（桌面端是无副作用的空操作，移动端会弹系统对话框）。
#[tauri::command]
pub fn notification_request_permission(app: AppHandle) -> Result<NotificationStatus, String> {
    let permission: NotificationPermission = app
        .notification()
        .request_permission()
        .map_err(|error| error.to_string())?
        .into();
    Ok(NotificationStatus { permission })
}

/// 发送一条本地通知。
///
/// 明确被拒绝时不尝试发送，直接回报 "permission-denied"——
/// 让前端能把“没权限”与“发送失败”区分开（§13 可解释状态）。
#[tauri::command]
pub fn notification_send(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), NotificationFailure> {
    let permission = permission_of(&app).unwrap_or(NotificationPermission::Prompt);
    if permission == NotificationPermission::Denied {
        return Err(NotificationFailure {
            kind: "permission-denied",
            message: "系统通知权限已被拒绝".to_string(),
        });
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| NotificationFailure {
            kind: "send-failed",
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_mapping_covers_every_plugin_state() {
        assert_eq!(
            NotificationPermission::from(PermissionState::Granted),
            NotificationPermission::Granted
        );
        assert_eq!(
            NotificationPermission::from(PermissionState::Denied),
            NotificationPermission::Denied
        );
        assert_eq!(
            NotificationPermission::from(PermissionState::Prompt),
            NotificationPermission::Prompt
        );
        // Android 的“需要说明理由”同样属于尚未授权。
        assert_eq!(
            NotificationPermission::from(PermissionState::PromptWithRationale),
            NotificationPermission::Prompt
        );
    }

    #[test]
    fn permission_serializes_to_kebab_case_for_the_frontend() {
        for (state, expected) in [
            (NotificationPermission::Granted, "\"granted\""),
            (NotificationPermission::Denied, "\"denied\""),
            (NotificationPermission::Prompt, "\"prompt\""),
        ] {
            assert_eq!(serde_json::to_string(&state).unwrap(), expected);
        }
    }
}
