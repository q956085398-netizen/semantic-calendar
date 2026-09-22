import { invoke } from "@tauri-apps/api/core";
import type { FileIO } from "./file-io";

/**
 * 桌面壳 FileIO：走 Rust 命令访问 app data dir 下的 store 目录。
 *
 * Rust 侧只接受安全文件名（无路径分隔符），因此这里把传入路径
 * 归一化为 basename；完整路径约定只属于 CalendarStore 调用方。
 */
export function createTauriFileIO(): FileIO {
  return {
    async readFile(path) {
      return invoke<string | null>("data_store_read", {
        fileName: baseName(path),
      });
    },
    async writeFile(path, contents) {
      await invoke("data_store_write", {
        fileName: baseName(path),
        contents,
      });
    },
    async renameFile(from, to) {
      await invoke("data_store_rename", {
        fromName: baseName(from),
        toName: baseName(to),
      });
    },
  };
}

function baseName(path: string): string {
  if (path.includes("/") || path.includes("\\")) {
    throw new Error(`存储路径应为纯文件名，收到：${path}`);
  }
  return path;
}
