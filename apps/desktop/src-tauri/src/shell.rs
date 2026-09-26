//! 桌面壳行为（SC-002 / app-spec §12、§15）。
//!
//! 这里只回答“窗口怎么活”：关闭窗口是隐藏到托盘还是退出、托盘如何恢复
//! 窗口、第二次启动怎么处理。它不认识日历数据，也不持有任何定时器——
//! 隐藏窗口后 Rust 侧没有任何唤醒源，后台唤醒只有前端 WebCal 调度器的
//! 单次 `setTimeout`（app-spec §12）。
//!
//! 关闭语义的权威来源是用户设置（键 `app.closeBehavior`），由前端在启动
//! 与切换时推送到这里；Rust 侧只保存运行时镜像，不自己读快照文件。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, Window, WindowEvent};

/// 主窗口 label，必须与 tauri.conf.json 的 `app.windows[0].label` 一致。
pub const MAIN_WINDOW_LABEL: &str = "main";

/// 托盘图标 id；同一进程只建一个托盘。
const TRAY_ID: &str = "semantic-calendar-tray";

const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// 关闭主窗口时的行为，取值与前端 `app.closeBehavior` 一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CloseBehavior {
    /// 隐藏到托盘，应用继续常驻（默认）。
    #[default]
    HideToTray,
    /// 关闭窗口即退出应用。
    Quit,
}

impl CloseBehavior {
    /// 设置值 → 行为；只认识字面量，未知值返回 `None` 交给调用方拒绝。
    /// 这里不做“猜一个默认值”，否则前端 bug 会变成静默的行为改变（P-03）。
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "hide-to-tray" => Some(Self::HideToTray),
            "quit" => Some(Self::Quit),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::HideToTray => "hide-to-tray",
            Self::Quit => "quit",
        }
    }
}

/// 窗口行为状态：前端推来的关闭语义 + 托盘可用性。
#[derive(Debug, Default)]
pub struct ShellState {
    close_behavior: Mutex<CloseBehavior>,
    /// 托盘创建失败（例如 bundle 图标缺失）时，隐藏窗口会让应用失去唯一
    /// 入口，因此“隐藏到托盘”退化为退出——宁可退出，也不把窗口藏起来。
    tray_available: AtomicBool,
}

impl ShellState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_close_behavior(&self, behavior: CloseBehavior) {
        *self
            .close_behavior
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = behavior;
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        *self
            .close_behavior
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set_tray_available(&self, available: bool) {
        self.tray_available.store(available, Ordering::Relaxed);
    }

    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::Relaxed)
    }

    /// 实际生效的关闭行为（考虑托盘是否真的可用）。
    pub fn effective_close_behavior(&self) -> CloseBehavior {
        effective_close_behavior(self.close_behavior(), self.tray_available())
    }
}

/// 关闭行为 + 托盘可用性 → 实际行为（纯函数，便于测试）。
pub fn effective_close_behavior(behavior: CloseBehavior, tray_available: bool) -> CloseBehavior {
    match (behavior, tray_available) {
        (CloseBehavior::HideToTray, false) => CloseBehavior::Quit,
        (behavior, _) => behavior,
    }
}

/// 该行为是否需要拦下关闭请求（阻止窗口真正关闭）。
pub fn should_prevent_close(behavior: CloseBehavior) -> bool {
    matches!(behavior, CloseBehavior::HideToTray)
}

/// 恢复主窗口：显示 → 取消最小化 → 聚焦。
/// 托盘点击、托盘菜单与第二实例启动共用这一条路径。
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        reveal_window(&window);
    }
}

fn reveal_window<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// 窗口事件入口：按关闭语义决定“隐藏”还是“放行退出”。
/// 非主窗口的事件不处理（v0.1 只有主窗口，但不要依赖这个巧合）。
///
/// 只拦截关闭请求：最小化按钮保持系统默认（最小化到任务栏），
/// 窗口隐藏后由托盘或第二实例恢复。
pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != MAIN_WINDOW_LABEL {
            return;
        }
        let state = window.app_handle().state::<ShellState>();
        if should_prevent_close(state.effective_close_behavior()) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn menu_error(error: tauri::Error) -> String {
    format!("创建托盘菜单失败：{error}")
}

/// 安装系统托盘：左键单击恢复主窗口，右键菜单提供“显示主窗口 / 退出”。
///
/// 返回 `Err` 表示托盘不可用（例如没有应用图标），调用方据此把
/// `tray_available` 置为 false，让关闭行为退化为退出而不是隐藏。
pub fn install_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, MENU_SHOW, "显示主窗口", true, None::<&str>)
        .map_err(menu_error)?;
    let quit_item =
        MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>).map_err(menu_error)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item]).map_err(menu_error)?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "缺少应用图标，无法创建托盘图标".to_string())?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("语义日历")
        .menu(&menu)
        // 左键留给“恢复窗口”，菜单走右键（Windows 托盘惯例）。
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map(|_| ())
        .map_err(|e| format!("创建托盘图标失败：{e}"))
}

/// 关闭行为设置的应用结果（IPC 返回值）。
///
/// 同时给出“请求的值”和“托盘是否可用”，让前端报告观察到的事实，
/// 而不是从返回值差异反推原因（app-spec §13 可解释状态）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseBehaviorStatus {
    /// 实际生效的关闭行为；托盘不可用时“隐藏到托盘”会退化为退出。
    pub behavior: &'static str,
    pub tray_available: bool,
}

/// 设置关闭行为（IPC）。只接受已知取值：未知值返回错误而不是静默改写
/// 语义，避免前端 bug 变成“设置看起来生效了，其实没有”。
#[tauri::command]
pub fn shell_set_close_behavior(
    state: tauri::State<'_, ShellState>,
    behavior: String,
) -> Result<CloseBehaviorStatus, String> {
    let parsed = CloseBehavior::parse(&behavior).ok_or_else(|| format!("未知的关闭行为：{behavior}"))?;
    state.set_close_behavior(parsed);
    Ok(CloseBehaviorStatus {
        behavior: state.effective_close_behavior().as_str(),
        tray_available: state.tray_available(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_behavior_round_trips_through_string() {
        for behavior in [CloseBehavior::HideToTray, CloseBehavior::Quit] {
            assert_eq!(CloseBehavior::parse(behavior.as_str()), Some(behavior));
        }
    }

    #[test]
    fn unknown_close_behavior_is_rejected_not_guessed() {
        for value in ["", "QUIT", "quit ", "minimize", "true", "hide_to_tray"] {
            assert_eq!(CloseBehavior::parse(value), None, "应拒绝 {value:?}");
        }
    }

    #[test]
    fn default_close_behavior_is_hide_to_tray() {
        assert_eq!(CloseBehavior::default(), CloseBehavior::HideToTray);
    }

    #[test]
    fn hidden_window_only_when_hide_to_tray_is_effective() {
        assert!(should_prevent_close(CloseBehavior::HideToTray));
        assert!(!should_prevent_close(CloseBehavior::Quit));
    }

    #[test]
    fn hide_to_tray_degrades_to_quit_without_tray() {
        assert_eq!(
            effective_close_behavior(CloseBehavior::HideToTray, true),
            CloseBehavior::HideToTray
        );
        // 没有托盘就没有恢复入口，隐藏窗口等于把应用藏起来。
        assert_eq!(
            effective_close_behavior(CloseBehavior::HideToTray, false),
            CloseBehavior::Quit
        );
        assert_eq!(
            effective_close_behavior(CloseBehavior::Quit, false),
            CloseBehavior::Quit
        );
    }

    #[test]
    fn shell_state_reflects_tray_availability() {
        let state = ShellState::new();
        // 默认：隐藏到托盘，但托盘尚未安装 —— 此时关闭就是退出。
        assert_eq!(state.close_behavior(), CloseBehavior::HideToTray);
        assert!(!state.tray_available());
        assert!(!should_prevent_close(state.effective_close_behavior()));

        state.set_tray_available(true);
        assert!(should_prevent_close(state.effective_close_behavior()));

        state.set_close_behavior(CloseBehavior::Quit);
        assert!(!should_prevent_close(state.effective_close_behavior()));
    }
}
