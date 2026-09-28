//! User supplied PNGs live in a dedicated app-data directory. Never accept paths from the webview.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

const MAX_PNG_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAssets {
    pub directory: String,
    pub assets: BTreeMap<String, String>,
    pub rejected: Vec<String>,
}

fn valid_png(bytes: &[u8]) -> bool {
    if bytes.len() < 33
        || bytes.len() as u64 > MAX_PNG_BYTES
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    (1..=2048).contains(&width) && (1..=2048).contains(&height)
}

fn scan_dir(
    base: &Path,
    folder: &str,
    prefix: &str,
    result: &mut UserAssets,
    total: &mut u64,
) -> Result<(), String> {
    let dir = base.join(folder);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建素材目录：{e}"))?;
    if !fs::symlink_metadata(&dir)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_dir()
    {
        return Err(format!("{folder} 素材目录不能是符号链接"));
    }
    for item in fs::read_dir(&dir).map_err(|e| format!("无法读取素材目录：{e}"))? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".png") else {
            continue;
        };
        if stem.is_empty()
            || stem.len() > 80
            || !stem
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            result
                .rejected
                .push(format!("{folder}/{name}: 文件名须为小写字母、数字和短横线"));
            continue;
        }
        let meta = fs::symlink_metadata(item.path()).map_err(|e| e.to_string())?;
        if !meta.file_type().is_file()
            || meta.len() > MAX_PNG_BYTES
            || *total + meta.len() > MAX_TOTAL_BYTES
        {
            result
                .rejected
                .push(format!("{folder}/{name}: 文件类型或大小不符合要求"));
            continue;
        }
        let bytes = fs::read(item.path()).map_err(|e| e.to_string())?;
        if !valid_png(&bytes) {
            result
                .rejected
                .push(format!("{folder}/{name}: 不是有效的 PNG 或尺寸超限"));
            continue;
        }
        *total += bytes.len() as u64;
        let reference = if folder == "days" {
            if let Some(rest) = stem.strip_prefix("festival-") {
                format!("bg.festival.{rest}")
            } else if let Some(rest) = stem.strip_prefix("solar-term-") {
                format!("bg.solar-term.{rest}")
            } else if let Some(rest) = stem.strip_prefix("holiday-") {
                format!("bg.holiday.{rest}")
            } else {
                result.rejected.push(format!(
                    "days/{name}: 文件名需以 festival-、solar-term- 或 holiday- 开头"
                ));
                continue;
            }
        } else {
            format!("{prefix}{stem}")
        };
        result.assets.insert(
            reference,
            format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn user_assets_scan(app: tauri::AppHandle) -> Result<UserAssets, String> {
    let base: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("custom-assets");
    fs::create_dir_all(&base).map_err(|e| format!("无法创建素材目录：{e}"))?;
    if !fs::symlink_metadata(&base)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_dir()
    {
        return Err("素材目录不能是符号链接".to_string());
    }
    let mut result = UserAssets {
        directory: base.display().to_string(),
        assets: BTreeMap::new(),
        rejected: vec![],
    };
    let mut total = 0;
    scan_dir(&base, "teams", "crest.team.", &mut result, &mut total)?;
    scan_dir(
        &base,
        "competitions",
        "logo.competition.",
        &mut result,
        &mut total,
    )?;
    scan_dir(&base, "days", "", &mut result, &mut total)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    #[test]
    fn validates_png_dimensions() {
        let mut bytes = vec![0; 33];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&128_u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&128_u32.to_be_bytes());
        assert!(valid_png(&bytes));
        bytes[20..24].copy_from_slice(&3000_u32.to_be_bytes());
        assert!(!valid_png(&bytes));
    }

    #[test]
    fn scans_named_team_image_without_accepting_arbitrary_paths() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "semantic-calendar-assets-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir_all(base.join("teams")).unwrap();
        let png = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZwZkAAAAASUVORK5CYII=").unwrap();
        fs::write(base.join("teams/custom-estonia-abcd.png"), png).unwrap();
        fs::write(base.join("teams/Bad Name.png"), b"not a png").unwrap();
        let mut result = UserAssets {
            directory: String::new(),
            assets: BTreeMap::new(),
            rejected: vec![],
        };
        let mut total = 0;
        scan_dir(&base, "teams", "crest.team.", &mut result, &mut total).unwrap();
        assert!(result.assets.contains_key("crest.team.custom-estonia-abcd"));
        assert_eq!(result.rejected.len(), 1);
        assert!(base
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(base).unwrap();
    }
}
