import { describe, expect, it } from "vitest";
import type { FileIO } from "../store/file-io";
import { CalendarStore } from "../store/calendar-store";
import type { HttpGetRequest, HttpGetResponse, HttpIO } from "../net/http-io";
import { addWebcalSubscription, refreshWebcalSource } from "./webcal-refresh";
import { sourceIdForWebcalUrl } from "./webcal-url";

const SECRET_URL = "https://calendar.example.com/feed.ics?token=SECRET-TOKEN";
const STORE_FILE = "calendar-store.json";

class MemoryFileIO implements FileIO {
  readonly files = new Map<string, string>();

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const contents = this.files.get(from);
    this.files.delete(from);
    if (contents !== undefined) {
      this.files.set(to, contents);
    }
  }
}

interface StubHttp extends HttpIO {
  requests: HttpGetRequest[];
}

/** 按顺序返回预置响应；用尽后重复最后一个。 */
function stubHttp(...responses: Array<HttpGetResponse | Error>): StubHttp {
  const requests: HttpGetRequest[] = [];
  let index = 0;
  return {
    requests,
    async get(request: HttpGetRequest): Promise<HttpGetResponse> {
      requests.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

function icsBody(...summaries: string[]): string {
  const events = summaries
    .map((summary, position) =>
      [
        "BEGIN:VEVENT",
        `UID:event-${position}@example.com`,
        `SUMMARY:${summary}`,
        "DTSTART:20261018T163000Z",
        "DTEND:20261018T183000Z",
        "END:VEVENT",
      ].join("\r\n"),
    )
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Semantic Calendar//Test//EN",
    events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function okResponse(
  body: string,
  validators: { etag?: string; lastModified?: string } = {},
): HttpGetResponse {
  return { status: 200, notModified: false, body, ...validators };
}

async function openStore(): Promise<{
  store: CalendarStore;
  fileIO: MemoryFileIO;
}> {
  const fileIO = new MemoryFileIO();
  const { store } = await CalendarStore.open(fileIO, STORE_FILE);
  return { store, fileIO };
}

/** 固定时钟：让状态时间与断言可确定。 */
function fixedClock(...isoTimes: string[]) {
  let index = 0;
  return () => new Date(isoTimes[Math.min(index++, isoTimes.length - 1)]);
}

describe("添加订阅（SRC-002）", () => {
  it("自定义名称在重复添加和刷新后保留，改名不影响身份、事件与缓存并可读回", async () => {
    const { store, fileIO } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup"), { etag: 'W/"v1"' }), {
      status: 304,
      notModified: true,
    });
    const first = await addWebcalSubscription(
      store,
      { url: SECRET_URL, name: "  欧冠  " },
      http,
    );
    expect(first.source?.name).toBe("欧冠");
    store.setSourceEnabled(first.sourceId!, false);
    await addWebcalSubscription(store, { url: SECRET_URL }, http);
    expect(store.getSource(first.sourceId!)?.name).toBe("欧冠");
    const events = store.listEvents();
    const before = store.getSource(first.sourceId!)!;
    expect(store.renameSource(first.sourceId!, "  德甲  ")).toBe(true);
    expect(store.getSource(first.sourceId!)).toEqual({
      ...before,
      name: "德甲",
    });
    expect(store.renameSource(first.sourceId!, "  ")).toBe(false);
    expect(store.renameSource("missing", "名称")).toBe(false);
    await refreshWebcalSource(store, first.sourceId!, http);
    expect(store.getSource(first.sourceId!)?.name).toBe("德甲");
    expect(store.listEvents()).toEqual(events);
    await store.save();
    const reopened = (await CalendarStore.open(fileIO, STORE_FILE)).store;
    expect(reopened.listSources()).toEqual(store.listSources());
    expect(reopened.listEvents()).toEqual(events);
    expect(reopened.getSource(first.sourceId!)?.webcal?.url).toBe(SECRET_URL);
    expect(reopened.getSource(first.sourceId!)?.enabled).toBe(false);
    const renamed = await addWebcalSubscription(
      store,
      { url: SECRET_URL, name: "我的赛程" },
      http,
    );
    expect(renamed.sourceId).toBe(first.sourceId);
    expect(renamed.source?.name).toBe("我的赛程");
    expect(store.listSources()).toHaveLength(1);
  });
  it("添加地址后立即抓取一次并落库事件", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Arsenal vs Manchester City"), {
        etag: 'W/"v1"',
      }),
    );

    const outcome = await addWebcalSubscription(
      store,
      { url: `  ${SECRET_URL}  ` },
      http,
      { now: fixedClock("2026-10-01T08:00:00.000Z") },
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.refresh?.status).toBe("updated");
    expect(outcome.refresh?.inserted).toBe(1);

    const [source] = store.listSources();
    expect(source.type).toBe("webcal");
    expect(source.enabled).toBe(true);
    expect(source.name).toBe("calendar.example.com/feed.ics");
    expect(source.lastSyncStatus).toBe("ok");
    expect(source.lastSyncAt).toBe("2026-10-01T08:00:00.000Z");
    expect(source.webcal).toEqual({
      url: SECRET_URL,
      etag: 'W/"v1"',
      lastModified: undefined,
      lastCheckedAt: "2026-10-01T08:00:00.000Z",
    });
    expect(store.listEvents()).toHaveLength(1);
    expect(http.requests[0].url).toBe(SECRET_URL);
  });

  it("webcal:// 写法与 https:// 写法命中同一来源，不产生副本", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));

    const first = await addWebcalSubscription(
      store,
      { url: "webcal://calendar.example.com/feed.ics?token=SECRET-TOKEN" },
      http,
    );
    const second = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
    );

    expect(second.sourceId).toBe(first.sourceId);
    expect(store.listSources()).toHaveLength(1);
    expect(store.listEvents()).toHaveLength(1);
  });

  it("重复添加时保留用户已设置的启用状态", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));
    const { sourceId } = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
    );
    store.setSourceEnabled(sourceId!, false);

    await addWebcalSubscription(store, { url: SECRET_URL }, http);

    expect(store.listSources()[0].enabled).toBe(false);
  });

  it("非法地址不创建来源，并给出可读原因", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));

    const outcome = await addWebcalSubscription(
      store,
      { url: "ftp://example.com/feed.ics" },
      http,
    );

    expect(outcome.sourceId).toBeUndefined();
    expect(outcome.error).toBe("只支持 http / https / webcal 地址");
    expect(store.listSources()).toEqual([]);
    expect(http.requests).toEqual([]);
  });

  it("首次抓取失败仍保留来源，便于用户修正或删除", async () => {
    const { store } = await openStore();
    const http = stubHttp(new Error("connect timeout"));

    const outcome = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
    );

    expect(outcome.refresh?.status).toBe("failed");
    expect(outcome.source?.lastSyncStatus).toBe("error");
    expect(store.listSources()).toHaveLength(1);
  });
});

describe("刷新：条件请求与缓存（SRC-002 / SRC-004）", () => {
  it("第二次刷新带上校验值，304 时事件不变但状态推进", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Arsenal vs Manchester City"), {
        etag: 'W/"v1"',
        lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
      }),
      { status: 304, notModified: true },
    );
    const clock = fixedClock(
      "2026-10-01T08:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
    );

    const added = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
      {
        now: clock,
      },
    );
    const outcome = await refreshWebcalSource(store, added.sourceId!, http, {
      now: clock,
    });

    expect(http.requests[1]).toEqual({
      url: SECRET_URL,
      etag: 'W/"v1"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
    });
    expect(outcome.status).toBe("not-modified");
    expect(store.listEvents()).toHaveLength(1);

    const [source] = store.listSources();
    expect(source.lastSyncStatus).toBe("ok");
    expect(source.lastSyncAt).toBe("2026-10-01T09:00:00.000Z");
    expect(source.webcal?.lastCheckedAt).toBe("2026-10-01T09:00:00.000Z");
    // 304 未返回校验值，但缓存仍然有效，保留原值继续使用。
    expect(source.webcal?.etag).toBe('W/"v1"');
  });

  it("200 且服务端不再返回校验值时清掉旧值", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Standup"), { etag: 'W/"v1"' }),
      okResponse(icsBody("Standup")),
    );

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    await refreshWebcalSource(store, added.sourceId!, http);

    const [source] = store.listSources();
    expect(source.webcal?.etag).toBeUndefined();
    expect(http.requests[1].etag).toBe('W/"v1"');
  });

  it("全量替换：源里消失的事件被删除", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("A", "B")),
      okResponse(icsBody("B")),
    );

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    expect(store.listEvents()).toHaveLength(2);

    const outcome = await refreshWebcalSource(store, added.sourceId!, http);

    expect(outcome.removed).toBe(1);
    expect(store.listEvents().map((event) => event.title)).toEqual(["B"]);
  });

  it("刷新不改变来源的启用状态与展示名", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));
    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    store.setSourceEnabled(added.sourceId!, false);

    await refreshWebcalSource(store, added.sourceId!, http);

    const [source] = store.listSources();
    expect(source.name).toBe("calendar.example.com/feed.ics");
    expect(source.enabled).toBe(false);
  });
});

describe("刷新失败与降级（§13 / SRC-004）", () => {
  it("网络异常保留旧事件与上次成功时间，并记录脱敏后的错误", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Arsenal vs Manchester City")),
      new Error(`error sending request for url (${SECRET_URL})`),
    );
    const clock = fixedClock(
      "2026-10-01T08:00:00.000Z",
      "2026-10-01T09:00:00.000Z",
    );

    const added = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
      {
        now: clock,
      },
    );
    const outcome = await refreshWebcalSource(store, added.sourceId!, http, {
      now: clock,
    });

    expect(outcome.status).toBe("failed");
    const [source] = store.listSources();
    expect(source.lastSyncStatus).toBe("error");
    expect(source.lastSyncError).toContain("网络请求失败");
    expect(source.lastSyncError).not.toContain("SECRET-TOKEN");
    // 上次成功时间保留，供 UI 显示“上次成功 …”。
    expect(source.lastSyncAt).toBe("2026-10-01T08:00:00.000Z");
    expect(source.webcal?.lastCheckedAt).toBe("2026-10-01T09:00:00.000Z");
    expect(store.listEvents()).toHaveLength(1);
  });

  it("HTTP 错误码按失败处理并保留缓存", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")), {
      status: 503,
      notModified: false,
    });

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    const outcome = await refreshWebcalSource(store, added.sourceId!, http);

    expect(outcome.error).toBe("订阅地址返回 HTTP 503");
    expect(store.listSources()[0].lastSyncStatus).toBe("error");
    expect(store.listEvents()).toHaveLength(1);
  });

  it("内容无法解析时保留旧事件", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Standup")),
      okResponse("<html>不是日历</html>"),
    );

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    const outcome = await refreshWebcalSource(store, added.sourceId!, http);

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("订阅内容无法解析");
    expect(store.listEvents()).toHaveLength(1);
  });

  it("事件级解析错误按 ICS-005 隔离，其余事件照常入库", async () => {
    const { store } = await openStore();
    const broken = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:good@example.com",
      "SUMMARY:Standup",
      "DTSTART:20261018T163000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:broken@example.com",
      "SUMMARY:缺少开始时间",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const http = stubHttp(okResponse(broken));

    const outcome = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
    );

    expect(outcome.refresh?.status).toBe("updated");
    expect(outcome.refresh?.skipped).toBe(1);
    expect(store.listSources()[0].lastSyncStatus).toBe("ok");
    expect(store.listEvents().map((event) => event.title)).toEqual(["Standup"]);
  });

  it("成功刷新会清掉上一次的错误状态", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      new Error("connect timeout"),
      okResponse(icsBody("Standup")),
    );

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    expect(store.listSources()[0].lastSyncError).toBeTruthy();

    await refreshWebcalSource(store, added.sourceId!, http);

    const [source] = store.listSources();
    expect(source.lastSyncStatus).toBe("ok");
    expect(source.lastSyncError).toBeUndefined();
  });

  it("未知来源返回失败而不是抛错", async () => {
    const { store } = await openStore();
    const outcome = await refreshWebcalSource(
      store,
      "webcal:missing",
      stubHttp(okResponse(icsBody("Standup"))),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("订阅不存在或已被删除");
  });

  it("空日历不清空已有缓存，按失败标记（§13 不删除旧数据）", async () => {
    const { store } = await openStore();
    const http = stubHttp(
      okResponse(icsBody("Arsenal vs Manchester City")),
      okResponse(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Semantic Calendar//Test//EN",
          "END:VCALENDAR",
          "",
        ].join("\r\n"),
      ),
    );

    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);
    const outcome = await refreshWebcalSource(store, added.sourceId!, http);

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("订阅内容为空，已保留本地缓存");
    expect(store.listEvents()).toHaveLength(1);
    expect(store.listSources()[0].lastSyncStatus).toBe("error");
  });

  it("来源本就没有事件时，空日历按正常刷新处理", async () => {
    const { store } = await openStore();
    const emptyCalendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Semantic Calendar//Test//EN",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const http = stubHttp(okResponse(emptyCalendar));

    const outcome = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      http,
    );

    expect(outcome.refresh?.status).toBe("updated");
    expect(store.listSources()[0].lastSyncStatus).toBe("ok");
  });

  it("抓取期间来源被删除时丢弃结果，不留下无主事件", async () => {
    const { store } = await openStore();
    const http: HttpIO = {
      async get(request: HttpGetRequest) {
        // 模拟用户在抓取途中点了删除。
        store.removeSource(sourceIdForWebcalUrl(request.url));
        return okResponse(icsBody("Standup"));
      },
    };

    const added = await addWebcalSubscription(
      store,
      { url: SECRET_URL },
      stubHttp(okResponse(icsBody("Standup"))),
    );
    const outcome = await refreshWebcalSource(store, added.sourceId!, http);

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("订阅已删除，结果已丢弃");
    expect(store.listEvents()).toEqual([]);
  });
});

describe("并发刷新（§12：避免不必要的重复下载）", () => {
  it("同一来源的并发刷新只发一次请求", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));
    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);

    const [a, b] = await Promise.all([
      refreshWebcalSource(store, added.sourceId!, http),
      refreshWebcalSource(store, added.sourceId!, http),
    ]);

    expect(a).toBe(b);
    expect(http.requests).toHaveLength(2); // 首次添加 1 次 + 合并后的 1 次
  });

  it("刷新结束后可以再次刷新（不残留进行中的状态）", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));
    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);

    await refreshWebcalSource(store, added.sourceId!, http);
    await refreshWebcalSource(store, added.sourceId!, http);

    expect(http.requests).toHaveLength(3);
  });
});

/**
 * SC-024：200 刷新走与本地导入同一组分片原语（解析 / 标准化 / 差集替换）。
 * 被测的是「真的让出了主线程」而不是「结果碰巧一样」：注入一个极小的分片粒度
 * 与一个记录调用的让出函数，304 与失败路径一次都不该让出。
 */
describe("200 刷新的分片执行（SC-024）", () => {
  it("200 刷新在解析、标准化与替换之间让出主线程，结果与不切片时相同", async () => {
    const summaries = Array.from(
      { length: 300 },
      (_unused, index) => `分片刷新事件 ${index}`,
    );
    // 两个变体都用阈值 0（一个任务只跑一片）：差别因此只来自事件粒度，
    // 不来自「谁跑得慢」。解析段有自己的粒度（VEVENT 块 / 文本行），
    // 两个变体都一样，不参与这条对照。
    const variants = [
      { label: "sliced", deps: { eventsPerChunk: 8, yieldAfterMs: 0 } },
      { label: "sync", deps: { eventsPerChunk: 0, yieldAfterMs: 0 } },
    ] as const;
    const outcomes: Record<string, unknown> = {};

    for (const variant of variants) {
      const { store } = await openStore();
      const http = stubHttp(okResponse(icsBody(...summaries)));
      const added = await addWebcalSubscription(
        store,
        { url: SECRET_URL },
        http,
      );
      let yields = 0;
      const outcome = await refreshWebcalSource(
        store,
        added.sourceId!,
        stubHttp(okResponse(icsBody(...summaries, "新增的一场"))),
        {
          ...variant.deps,
          yieldToMain: async () => {
            yields += 1;
          },
        },
      );

      expect(outcome.status).toBe("updated");
      expect(store.listEvents()).toHaveLength(301);
      outcomes[variant.label] = {
        yields,
        inserted: outcome.inserted,
        updated: outcome.updated,
        removed: outcome.removed,
      };
    }

    // 事件粒度 0 = 不切片：标准化与替换两段一次算完，让出只可能来自解析段
    // （它对两个变体一样）。因此「分片变体让出得更多」只可能来自事件粒度。
    const sliced = outcomes.sliced as { yields: number; inserted: number };
    const sync = outcomes.sync as { yields: number; inserted: number };
    expect(sliced.yields).toBeGreaterThan(sync.yields + 10);
    expect(sliced.inserted).toBe(sync.inserted);
    expect(sliced.inserted).toBe(1);
  });

  it("304 与失败刷新不让出：没有分片工作可做", async () => {
    const { store } = await openStore();
    const http = stubHttp(okResponse(icsBody("Standup")));
    const added = await addWebcalSubscription(store, { url: SECRET_URL }, http);

    let yields = 0;
    const outcome = await refreshWebcalSource(
      store,
      added.sourceId!,
      stubHttp({ status: 304, notModified: true }),
      {
        yieldToMain: async () => {
          yields += 1;
        },
      },
    );

    expect(outcome.status).toBe("not-modified");
    expect(yields).toBe(0);
  });
});
