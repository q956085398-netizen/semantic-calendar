/**
 * 持久化文件访问端口。
 *
 * 读写单位是“整份文件文本”。原子性（临时文件 + rename）由调用方
 * CalendarStore 组合实现，端口实现只保证：
 * - readFile：文件不存在时返回 null，而不是抛错；
 * - writeFile：自动创建父目录。
 *
 * 桌面壳由 Tauri Rust 命令实现（tauri-file-io.ts），
 * 测试与 Node 环境使用 node-file-io.ts 中的 NodeFileIO。
 */
export interface FileIO {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, contents: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
}
