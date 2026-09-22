#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{name}。Tauri IPC 工作正常。")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running Semantic Calendar");
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn greet_returns_expected_message() {
        assert_eq!(
            greet("Semantic Calendar"),
            "你好，Semantic Calendar。Tauri IPC 工作正常。"
        );
    }
}
