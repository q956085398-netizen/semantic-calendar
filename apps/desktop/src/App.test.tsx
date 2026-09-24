import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
}));

function asPromise(value: unknown): Promise<unknown> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

/** 按命令分发 IPC mock，未配置的命令默认成功返回 null。 */
function mockBackend(
  overrides: {
    dataStoreRead?: string | null | Error;
  } = {},
) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "data_store_read") {
      return asPromise(overrides.dataStoreRead ?? null);
    }
    return Promise.resolve(null);
  });
}

function writtenSnapshots(): Array<Record<string, unknown>> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "data_store_write")
    .map(
      ([, args]) =>
        JSON.parse(String(args?.contents)) as Record<string, unknown>,
    );
}

function seededSnapshot(settings: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    sources: [],
    events: [],
    enrichments: {},
    settings,
  });
}

/** 固定“今天”为 2026-09-23（周三），让月视图断言确定性。 */
function freezeClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0));
}

beforeEach(() => {
  invokeMock.mockReset();
  mockBackend();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("三栏布局与月视图（SC-004 / CAL-001 / CAL-004）", () => {
  it("渲染侧栏、月历主区域与详情栏三个区域", () => {
    freezeClock();
    render(<App />);

    expect(screen.getByRole("complementary", { name: "侧栏" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "详情栏" })).toBeTruthy();
    expect(screen.getByText("语义日历")).toBeTruthy();
  });

  it("月视图：当前年月标题、7 列表头、42 格、跨月弱化、今天标记", () => {
    freezeClock();
    render(<App />);

    expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);

    // 周一起始：首格是 8月31日，跨月格带 data-outside。
    const leading = grid.querySelector('[data-date="2026-08-31"]');
    expect(leading?.getAttribute("data-outside")).toBe("true");

    const todayCell = grid.querySelector('[data-today="true"]');
    expect(todayCell?.getAttribute("data-date")).toBe("2026-09-23");
    expect(todayCell?.getAttribute("aria-current")).toBe("date");

    // 今天只标记一次。
    expect(grid.querySelectorAll('[data-today="true"]')).toHaveLength(1);
  });

  it("视图切换控件：月为唯一可用视图", () => {
    freezeClock();
    render(<App />);

    const segmented = screen.getByRole("group", { name: "视图切换" });
    const monthButton = within(segmented).getByRole("button", { name: "月" });
    expect(monthButton.getAttribute("aria-pressed")).toBe("true");

    const weekButton = within(segmented).getByRole("button", {
      name: "周",
    }) as HTMLButtonElement;
    const dayButton = within(segmented).getByRole("button", {
      name: "日",
    }) as HTMLButtonElement;
    expect(weekButton.disabled).toBe(true);
    expect(dayButton.disabled).toBe(true);
  });

  it("侧栏可折叠 / 展开，月历始终保留", () => {
    freezeClock();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));

    expect(screen.queryByRole("complementary", { name: "侧栏" })).toBeNull();
    expect(screen.getByRole("main")).toBeTruthy();

    const rail = screen.getByRole("button", { name: "展开侧栏" });
    expect(rail.getAttribute("aria-expanded")).toBe("false");
    expect(rail.getAttribute("aria-controls")).toBe("app-sidebar");

    fireEvent.click(rail);
    expect(screen.getByRole("complementary", { name: "侧栏" })).toBeTruthy();
  });

  it("详情栏可折叠 / 展开", () => {
    freezeClock();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "收起详情" }));

    expect(screen.queryByRole("complementary", { name: "详情栏" })).toBeNull();
    expect(screen.getByRole("main")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开详情" }));
    expect(screen.getByRole("complementary", { name: "详情栏" })).toBeTruthy();
  });

  it("窄窗口自动折叠：先右栏，再左栏（ui-design §23）", () => {
    freezeClock();
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(max-width: 1080px)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );

    render(<App />);

    // 1080px 以下：详情栏自动收起且可临时展开，侧栏仍在。
    expect(screen.queryByRole("complementary", { name: "详情栏" })).toBeNull();
    expect(screen.getByRole("button", { name: "展开详情" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "侧栏" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("详情栏展示今天的极简日期详情（§12）", () => {
    freezeClock();
    render(<App />);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("WEDNESDAY")).toBeTruthy();
    expect(within(inspector).getByText("9月23日")).toBeTruthy();
    expect(within(inspector).getByText("2026")).toBeTruthy();
  });
});

describe("月份导航与日期选择（SC-005 / CAL-002 / CAL-003）", () => {
  it("上一月 / 下一月切换年月与网格日期", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");

    fireEvent.click(within(main).getByRole("button", { name: "下一月" }));
    expect(
      within(main).getByRole("heading", { name: "2026年10月" }),
    ).toBeTruthy();
    const octoberGrid = within(main).getByRole("grid", { name: "2026年10月" });
    // 2026-10-01 是周四：周一起始的首格是 9月28日。
    expect(octoberGrid.querySelector('[data-date="2026-09-28"]')).toBeTruthy();
    const firstInMonth = octoberGrid.querySelector('[data-date="2026-10-01"]');
    expect(firstInMonth?.hasAttribute("data-outside")).toBe(false);
    // 今天（9月23日）不在 10 月网格内：无 today 标记。
    expect(octoberGrid.querySelectorAll('[data-today="true"]')).toHaveLength(0);

    fireEvent.click(within(main).getByRole("button", { name: "上一月" }));
    expect(
      within(main).getByRole("heading", { name: "2026年9月" }),
    ).toBeTruthy();
  });

  it("纯月份导航后网格仍保留键盘落点（§16 / §24）", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");

    // 连续导航到 12 月：选中日期（9月23日）与今天都不在该网格内。
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(within(main).getByRole("button", { name: "下一月" }));
    }
    const decemberGrid = within(main).getByRole("grid", { name: "2026年12月" });
    expect(
      decemberGrid.querySelectorAll('[aria-selected="true"]'),
    ).toHaveLength(0);
    // 当月首格兜底进入 tab 序，键盘用户不会丢失网格入口。
    const firstCell = decemberGrid.querySelector(
      '[data-date="2026-12-01"]',
    ) as HTMLElement;
    expect(firstCell.tabIndex).toBe(0);
  });

  it("「今天」回到当前月并选中今天", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");

    fireEvent.click(within(main).getByRole("button", { name: "下一月" }));
    fireEvent.click(within(main).getByRole("button", { name: "今天" }));

    expect(
      within(main).getByRole("heading", { name: "2026年9月" }),
    ).toBeTruthy();
    const todayCell = within(main)
      .getByRole("grid", { name: "2026年9月" })
      .querySelector('[data-date="2026-09-23"]');
    expect(todayCell?.getAttribute("aria-selected")).toBe("true");

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("9月23日")).toBeTruthy();
  });

  it("点击日期更新选中与 Inspector，今天标记不受影响", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");
    const grid = within(main).getByRole("grid", { name: "2026年9月" });

    fireEvent.click(grid.querySelector('[data-date="2026-09-12"]')!);

    const selected = grid.querySelector('[data-date="2026-09-12"]');
    expect(selected?.getAttribute("aria-selected")).toBe("true");
    expect(selected?.className).toContain("is-selected");
    expect(grid.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
    expect(
      grid.querySelector('[data-today="true"]')?.getAttribute("data-date"),
    ).toBe("2026-09-23");

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("SATURDAY")).toBeTruthy();
    expect(within(inspector).getByText("9月12日")).toBeTruthy();
  });

  it("点击跨月日期切换到对应月份并保持选中", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");

    fireEvent.click(
      within(main)
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-10-08"]')!,
    );

    expect(
      within(main).getByRole("heading", { name: "2026年10月" }),
    ).toBeTruthy();
    const octoberGrid = within(main).getByRole("grid", { name: "2026年10月" });
    const selected = octoberGrid.querySelector('[data-date="2026-10-08"]');
    expect(selected?.getAttribute("aria-selected")).toBe("true");
    expect(selected?.hasAttribute("data-outside")).toBe(false);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("THURSDAY")).toBeTruthy();
    expect(within(inspector).getByText("10月8日")).toBeTruthy();
  });

  it("方向键移动选择，焦点跟随，跨月自动导航（roving tabindex）", async () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");
    const grid = within(main).getByRole("grid", { name: "2026年9月" });

    // 初始：今天为选中格，进入 tab 序；其余格移出。
    const todayCell = grid.querySelector(
      '[data-date="2026-09-23"]',
    ) as HTMLElement;
    expect(todayCell.tabIndex).toBe(0);
    expect(
      (grid.querySelector('[data-date="2026-09-24"]') as HTMLElement).tabIndex,
    ).toBe(-1);

    fireEvent.keyDown(todayCell, { key: "ArrowRight" });
    expect(
      grid
        .querySelector('[data-date="2026-09-24"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-date")).toBe(
        "2026-09-24",
      ),
    );

    // +7 天跨入 10 月：视图联动切换，焦点与选中落在 10月1日。
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    expect(
      within(main).getByRole("heading", { name: "2026年10月" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-date")).toBe(
        "2026-10-01",
      ),
    );
    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("10月1日")).toBeTruthy();

    // -7 天回到 9 月。
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    expect(
      within(main).getByRole("heading", { name: "2026年9月" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-date")).toBe(
        "2026-09-24",
      ),
    );
  });

  it("小月历与主视图联动（CAL-002）", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");
    const sidebar = screen.getByRole("complementary", { name: "侧栏" });

    expect(within(sidebar).getByText("2026年9月")).toBeTruthy();

    // 主视图导航 → 小月历跟随。
    fireEvent.click(within(main).getByRole("button", { name: "下一月" }));
    expect(within(sidebar).getByText("2026年10月")).toBeTruthy();

    // 小月历点击日期 → 主视图选中并更新 Inspector。
    fireEvent.click(
      within(sidebar).getByRole("button", { name: "2026年10月18日" }),
    );
    expect(
      within(main)
        .getByRole("grid", { name: "2026年10月" })
        .querySelector('[data-date="2026-10-18"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("10月18日")).toBeTruthy();

    // 小月历后退 → 主视图跟随。
    fireEvent.click(within(sidebar).getByRole("button", { name: "上一月" }));
    expect(
      within(main).getByRole("heading", { name: "2026年9月" }),
    ).toBeTruthy();
    expect(within(sidebar).getByText("2026年9月")).toBeTruthy();
  });
});

describe("明暗主题（THEME-001 / THEME-002 / THEME-003）", () => {
  it("从持久化快照恢复深色主题", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({
        "app.lastOpenedAt": "2026-09-22T10:00:00.000Z",
        "app.theme": "dark",
      }),
    });

    render(<App />);

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    const toggle = screen.getByRole("button", { name: "切换浅色主题" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("切换主题写入快照设置", async () => {
    mockBackend({ dataStoreRead: seededSnapshot() });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "切换深色主题" }));
    expect(document.documentElement.dataset.theme).toBe("dark");

    await waitFor(() => {
      const withTheme = writtenSnapshots().filter(
        (snapshot) =>
          (snapshot.settings as Record<string, unknown>)["app.theme"] !==
          undefined,
      );
      expect(withTheme).toHaveLength(1);
      expect(withTheme[0].settings).toMatchObject({ "app.theme": "dark" });
    });
  });

  it("浏览器预览模式下可切换但不持久化", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "切换深色主题" }));
    expect(document.documentElement.dataset.theme).toBe("dark");

    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "data_store_write"),
    ).toHaveLength(0);
  });
});

/** SC-006 集成：文件选择 → ICS 解析 → 落库 → 月视图可见。 */
const IMPORT_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:evening@example.com",
  "SUMMARY:晚间例会",
  "DTSTART:20260923T190000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:allday@example.com",
  "SUMMARY:全天出行",
  "DTSTART;VALUE=DATE:20260924",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

/** SC-008 集成：重复规则 + EXDATE + RECURRENCE-ID 例外 → 月格展开可见。 */
const RECURRING_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:weekly-review@example.com",
  "SUMMARY:每周复盘",
  "DTSTART:20260923T090000",
  "RRULE:FREQ=WEEKLY;COUNT=8",
  "EXDATE:20260930T090000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:weekly-review@example.com",
  "RECURRENCE-ID:20261007T090000",
  "SUMMARY:每周复盘（改期）",
  "DTSTART:20261008T100000",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

function icsFile(contents: string, name = "team.ics"): File {
  return new File([contents], name, { type: "text/calendar" });
}

function chooseImportFile(file: File) {
  const input = screen.getByLabelText(/导入 ICS 文件/) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

/** 冻结时钟、渲染 App 并等待本地数据层就绪。 */
async function renderReadyApp() {
  freezeClock();
  render(<App />);
  await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());
}

describe("本地 ICS 导入（SC-006 / SRC-001）", () => {
  it("导入后事件落在月格并在侧栏出现数据源", async () => {
    await renderReadyApp();

    chooseImportFile(icsFile(IMPORT_ICS));

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    await waitFor(() =>
      expect(
        within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
          "19:00 晚间例会",
        ),
      ).toBeTruthy(),
    );
    expect(
      within(grid.querySelector('[data-date="2026-09-24"]')!).getByText(
        "全天出行",
      ),
    ).toBeTruthy();

    // 侧栏列出新建数据源。
    const sidebar = screen.getByRole("complementary", { name: "侧栏" });
    expect(within(sidebar).getByText("team.ics")).toBeTruthy();
  });

  it("导入结果写入本地快照（解析 → 落库链路）", async () => {
    await renderReadyApp();

    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    const lastSnapshot = writtenSnapshots().at(-1)!;
    expect(lastSnapshot.sources).toEqual([
      expect.objectContaining({
        id: "local-ics:team",
        type: "local-ics",
        name: "team.ics",
        enabled: true,
        lastSyncStatus: "ok",
      }),
    ]);
    expect(lastSnapshot.events).toHaveLength(2);
    expect(lastSnapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: "evening@example.com",
          title: "晚间例会",
          start: "2026-09-23T19:00:00",
          allDay: false,
        }),
        expect.objectContaining({
          uid: "allday@example.com",
          start: "2026-09-24",
          allDay: true,
        }),
      ]),
    );
  });

  it("重复导入同一文件不产生重复副本（ICS-001）", async () => {
    await renderReadyApp();

    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());
    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/更新 2/)).toBeTruthy());

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    const todayCell = grid.querySelector(
      '[data-date="2026-09-23"]',
    ) as HTMLElement;
    expect(within(todayCell).getAllByText("19:00 晚间例会")).toHaveLength(1);
    expect(writtenSnapshots().at(-1)!.events).toHaveLength(2);
  });

  it("坏事件被隔离并计入导入报告（ICS-005）", async () => {
    await renderReadyApp();

    const mixed = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "SUMMARY:没有 UID",
      "DTSTART:20260923T190000",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:good@example.com",
      "SUMMARY:好事件",
      "DTSTART:20260923T200000",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    chooseImportFile(icsFile(mixed));

    await waitFor(() => expect(screen.getByText(/新增 1/)).toBeTruthy());
    expect(screen.getByText(/跳过 1/)).toBeTruthy();
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
        "20:00 好事件",
      ),
    ).toBeTruthy();
  });

  it("非 ICS 文件提示失败且不创建数据源", async () => {
    await renderReadyApp();

    chooseImportFile(icsFile("这不是日历文件", "broken.ics"));

    await waitFor(() =>
      expect(screen.getByText(/导入失败：不是有效的 ICS/)).toBeTruthy(),
    );
    const sidebar = screen.getByRole("complementary", { name: "侧栏" });
    expect(within(sidebar).queryByText("broken.ics")).toBeNull();
    expect(writtenSnapshots().at(-1)!.sources).toEqual([]);
  });

  it("点击日期后 Inspector 列出当日事件（CAL-003）", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-24"]') as HTMLElement,
    );

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("全天出行")).toBeTruthy();
    expect(within(inspector).getByText("全天")).toBeTruthy();
  });

  it("预览模式下导入给出降级提示", async () => {
    freezeClock();
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());

    chooseImportFile(icsFile(IMPORT_ICS));

    await waitFor(() =>
      expect(screen.getByText(/预览模式.*导入/)).toBeTruthy(),
    );
  });
});

describe("重复事件月格展开（SC-008 / ICS-004）", () => {
  it("每周规则在月格展开；EXDATE 排除；RECURRENCE-ID 改期不重复", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(RECURRING_ICS, "review.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    // 9 月网格覆盖 8-31 … 10-11；周三 09:00 系列：9/23、9/30（被 EXDATE）、10/7（被改期）。
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
        "09:00 每周复盘",
      ),
    ).toBeTruthy();

    const excluded = grid.querySelector(
      '[data-date="2026-09-30"]',
    ) as HTMLElement;
    expect(within(excluded).queryByText(/每周复盘/)).toBeNull();

    const original = grid.querySelector(
      '[data-date="2026-10-07"]',
    ) as HTMLElement;
    expect(within(original).queryByText(/每周复盘/)).toBeNull();

    // 改期实例落在 10-08 10:00（跨月格可见），且全网格只出现这一个改期实例。
    expect(
      within(grid.querySelector('[data-date="2026-10-08"]')!).getByText(
        "10:00 每周复盘（改期）",
      ),
    ).toBeTruthy();
    expect(within(grid).getAllByText(/每周复盘（改期）/)).toHaveLength(1);
  });
});

describe("语义增强接线（SC-009 / SEM-003）", () => {
  it("导入后执行匹配：当前注册表无领域 Matcher，全部回退普通显示", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    // 月格摘要无任何语义标记：引擎已执行，未命中不写增强（SEM-003）。
    expect(grid.querySelectorAll(".cell-event.is-semantic")).toHaveLength(0);
    expect(grid.querySelectorAll("[data-semantic-type]")).toHaveLength(0);
    // 普通事件照常渲染，不会因为匹配为空而消失。
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
        "19:00 晚间例会",
      ),
    ).toBeTruthy();

    // 快照里增强分区为空：原始事件分区不受影响。
    const lastSnapshot = writtenSnapshots().at(-1)!;
    expect(lastSnapshot.enrichments).toEqual({});
    expect(lastSnapshot.events).toHaveLength(2);
  });

  it("点击日期后详情栏同样按普通事件显示，无语义标签", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-24"]') as HTMLElement,
    );

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(
      inspector.querySelectorAll(".inspector-event.is-semantic"),
    ).toHaveLength(0);
    expect(within(inspector).queryByText("法定节假日")).toBeNull();
    expect(within(inspector).getByText("全天出行")).toBeTruthy();
  });
});

describe("本地数据层接线", () => {
  it("首次启动时创建快照并记录启动时间", async () => {
    freezeClock();
    mockBackend({ dataStoreRead: null });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());
    expect(screen.getByText(/schema v1/)).toBeTruthy();

    const snapshots = writtenSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].schemaVersion).toBe(1);
    expect(
      (snapshots[0].settings as Record<string, unknown>)["app.lastOpenedAt"],
    ).toEqual(expect.any(String));
    expect(invokeMock).toHaveBeenCalledWith("data_store_read", {
      fileName: "calendar-store.json",
    });
  });

  it("再次启动时从持久化快照读回上次启动时间", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({
        "app.lastOpenedAt": "2026-09-22T10:00:00.000Z",
      }),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/上次启动/)).toBeTruthy());
  });

  it("损坏快照被隔离并重置，月视图照常可用", async () => {
    mockBackend({ dataStoreRead: "{oops" });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/本地数据层已重置（文件损坏）/)).toBeTruthy(),
    );
    // 隔离改名（corrupt-* 后缀）只发生一次；save 的原子写也用 rename，需排除。
    const quarantineRenames = invokeMock.mock.calls.filter(
      ([cmd, args]) =>
        cmd === "data_store_rename" &&
        String(args?.toName).startsWith("calendar-store.json.corrupt-"),
    );
    expect(quarantineRenames).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
  });

  it("无 IPC 环境下降级为预览提示", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());
    expect(screen.getByRole("main")).toBeTruthy();
  });
});
