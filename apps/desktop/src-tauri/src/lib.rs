use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

/// 本地数据快照所在的子目录（位于系统 app data dir 之下）。
const STORE_DIR_NAME: &str = "store";
const STORE_FILE_NAME_MAX_LEN: usize = 128;

/// 前端只允许访问 store 目录内、文件名仅含安全字符的文件，
/// 防止 webview 通过路径穿越读写任意位置。
fn validate_store_file_name(file_name: &str) -> Result<(), String> {
    let invalid = || format!("非法存储文件名：{file_name}");
    if file_name.is_empty()
        || file_name.len() > STORE_FILE_NAME_MAX_LEN
        || file_name == "."
        || file_name == ".."
        || !file_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(invalid());
    }
    Ok(())
}

fn resolve_store_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    validate_store_file_name(file_name)?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
    Ok(base.join(STORE_DIR_NAME).join(file_name))
}

fn read_store_file(path: &Path) -> std::io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// 写入快照文件：只负责创建目录与写入。
/// 原子性（临时文件 + rename）由前端 CalendarStore 统一组合，
/// 避免两层各做一遍导致 `.tmp.tmp` 双跳。
fn write_store_file(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)
}

fn rename_store_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to)
}

#[tauri::command]
fn data_store_read(app: tauri::AppHandle, file_name: String) -> Result<Option<String>, String> {
    let path = resolve_store_path(&app, &file_name)?;
    read_store_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_store_write(
    app: tauri::AppHandle,
    file_name: String,
    contents: String,
) -> Result<(), String> {
    let path = resolve_store_path(&app, &file_name)?;
    write_store_file(&path, &contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn data_store_rename(
    app: tauri::AppHandle,
    from_name: String,
    to_name: String,
) -> Result<(), String> {
    let from = resolve_store_path(&app, &from_name)?;
    let to = resolve_store_path(&app, &to_name)?;
    rename_store_file(&from, &to).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_store_read,
            data_store_write,
            data_store_rename
        ])
        .run(tauri::generate_context!())
        .expect("error while running Semantic Calendar");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_DIR_SEQ: AtomicU32 = AtomicU32::new(0);

    fn temp_dir() -> PathBuf {
        let seq = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("semantic-calendar-rs-{}-{seq}", std::process::id()));
        fs::create_dir_all(&dir).expect("创建临时目录失败");
        dir
    }

    #[test]
    fn file_name_validation_accepts_safe_names() {
        for name in [
            "calendar-store.json",
            "calendar-store.json.corrupt-2026-09-23T00-00-00-000Z",
            "a-b_c.d",
        ] {
            assert!(validate_store_file_name(name).is_ok(), "应接受 {name}");
        }
    }

    #[test]
    fn file_name_validation_rejects_traversal_and_separators() {
        for name in [
            "",
            ".",
            "..",
            "../secret.json",
            "a/b.json",
            "a\\b.json",
            "日历.json",
            "store name.json",
        ] {
            assert!(validate_store_file_name(name).is_err(), "应拒绝 {name:?}");
        }
    }

    #[test]
    fn read_store_file_returns_none_when_missing() {
        let dir = temp_dir();
        let result = read_store_file(&dir.join("absent.json")).expect("读取不应报错");
        assert_eq!(result, None);
    }

    #[test]
    fn write_store_file_creates_dirs_and_replaces_existing() {
        let dir = temp_dir();
        let path = dir.join("nested").join("store").join("calendar-store.json");

        write_store_file(&path, "{\"schemaVersion\":1}").expect("首次写入失败");
        assert_eq!(
            read_store_file(&path).expect("读取失败").as_deref(),
            Some("{\"schemaVersion\":1}")
        );

        write_store_file(&path, "{\"schemaVersion\":2}").expect("覆盖写入失败");
        assert_eq!(
            read_store_file(&path).expect("读取失败").as_deref(),
            Some("{\"schemaVersion\":2}")
        );

        // 写入只产生目标文件。
        let entries: Vec<_> = fs::read_dir(path.parent().unwrap())
            .expect("列目录失败")
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec!["calendar-store.json"]);
    }

    #[test]
    fn rename_store_file_moves_within_store_dir() {
        let dir = temp_dir();
        let from = dir.join("calendar-store.json");
        let to = dir.join("calendar-store.json.corrupt-backup");

        write_store_file(&from, "data").expect("写入失败");
        rename_store_file(&from, &to).expect("rename 失败");

        assert_eq!(read_store_file(&from).expect("读取失败"), None);
        assert_eq!(
            read_store_file(&to).expect("读取失败").as_deref(),
            Some("data")
        );
    }
}
