import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileIO } from "./file-io";

/**
 * FileIO 的 Node 实现，仅供测试与 Node 环境使用。
 * 单独成文件是为了把 node: 导入隔离在浏览器包之外。
 */
export class NodeFileIO implements FileIO {
  async readFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async writeFile(filePath: string, contents: string): Promise<void> {
    const parent = path.dirname(filePath);
    await mkdir(parent, { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  async renameFile(from: string, to: string): Promise<void> {
    await rename(from, to);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
