/**
 * 基线测量用的公共装配（SC-020）。
 *
 * 只放“怎么搭出一个可测量的场景”，不放被测逻辑：临时目录、HTTP 替身、
 * 已播种事件的存储。基准文件各自决定测量哪一段。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CalendarSource, StoredEvent } from "../data/model";
import type { HttpGetResponse, HttpIO } from "../data/net/http-io";
import { CalendarStore } from "../data/store/calendar-store";
import { NodeFileIO } from "../data/store/node-file-io";

/** 基准用的临时目录：真实磁盘 I/O，落盘 / 读取的耗时才可信。 */
export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "semantic-calendar-bench-"));
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** 固定响应的 HTTP 替身（条件 GET 的全部需求就是这个形状）。 */
export function stubHttp(response: HttpGetResponse): HttpIO {
  return {
    async get(): Promise<HttpGetResponse> {
      return response;
    },
  };
}

/**
 * 造一个已落盘事件的存储：与真实启动路径一样经过 `save()`，
 * 因此“读取快照”测的是磁盘上真实存在的文件。
 */
export async function seededStore(
  filePath: string,
  source: CalendarSource,
  events: readonly StoredEvent[],
): Promise<CalendarStore> {
  const { store } = await CalendarStore.open(new NodeFileIO(), filePath);
  store.upsertSource(source);
  store.upsertEvents(source.id, [...events]);
  await store.save();
  return store;
}
