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
import { buildIcsFixture } from "./bench/fixtures";
import { CalendarStore } from "./data/store/calendar-store";
import {
  APP_LICENSE,
  APP_NAME_EN,
  APP_NAME_ZH,
  APP_VERSION,
} from "./settings/app-info";

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
    /** 落盘结果（SC-019）：默认成功，可注入磁盘错误。 */
    dataStoreWrite?: unknown;
    webcalFetch?: (args: Record<string, unknown>) => unknown;
    shellSetCloseBehavior?: unknown;
    /** 通知权限状态（SC-017）；默认已允许。 */
    notificationStatus?: unknown;
    /** 通知发送结果（SC-017）；默认发送成功。 */
    notificationSend?: unknown;
  } = {},
) {
  invokeMock.mockImplementation(
    (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "data_store_read") {
        return asPromise(overrides.dataStoreRead ?? null);
      }
      if (cmd === "data_store_write") {
        return asPromise(overrides.dataStoreWrite ?? null);
      }
      if (cmd === "webcal_fetch") {
        return asPromise(
          overrides.webcalFetch ? overrides.webcalFetch(args ?? {}) : null,
        );
      }
      if (cmd === "shell_set_close_behavior") {
        // 默认模拟“托盘可用”的正常回答：桌面壳回显实际生效的行为。
        return asPromise(
          overrides.shellSetCloseBehavior ?? {
            behavior: args?.behavior,
            trayAvailable: true,
          },
        );
      }
      if (
        cmd === "notification_status" ||
        cmd === "notification_request_permission"
      ) {
        return asPromise(
          overrides.notificationStatus ?? { permission: "granted" },
        );
      }
      if (cmd === "notification_send") {
        return asPromise(overrides.notificationSend ?? null);
      }
      return Promise.resolve(null);
    },
  );
}

/** 已发送的本地通知（SC-017）：桌面壳收到的标题与正文。 */
function sentNotifications(): Array<{ title: string; body: string }> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "notification_send")
    .map(([, args]) => ({
      title: String(args?.title),
      body: String(args?.body),
    }));
}

/** 快照 settings（最近一次落盘）：通知设置与去重日志的断言点。 */
function snapshotSettings(): Record<string, unknown> {
  return writtenSnapshots().at(-1)!.settings as Record<string, unknown>;
}

/** 从冻结的当前时刻推进到指定本地时刻（假定时器）。 */
async function advanceTo(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Promise<void> {
  const delta =
    new Date(year, month - 1, day, hour, minute).getTime() - Date.now();
  await vi.advanceTimersByTimeAsync(Math.max(0, delta));
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
  vi.restoreAllMocks();
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

  it("详情栏展示今天的日期详情（§12）", () => {
    freezeClock();
    render(<App />);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    // 2026-09-23 是秋分：星期行带语义类型（SC-012 / §9.2），日期行照常克制。
    expect(within(inspector).getByText("WEDNESDAY · SOLAR TERM")).toBeTruthy();
    expect(within(inspector).getByText("9月23日")).toBeTruthy();
    expect(within(inspector).getByText("2026")).toBeTruthy();
  });

  it("普通日期没有节日 / 节气语义（SC-012）", () => {
    freezeClock();
    render(<App />);

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    fireEvent.click(grid.querySelector('[data-date="2026-09-24"]')!);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("THURSDAY")).toBeTruthy();
    expect(inspector.querySelector(".inspector-day-semantics")).toBeNull();
    // 普通日期的月格也不挂语义标记。
    const cell = grid.querySelector('[data-date="2026-09-24"]');
    expect(cell?.hasAttribute("data-china-semantic")).toBe(false);
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
    // 2026-10-08 是寒露：星期行带 SOLAR TERM（SC-012）。
    expect(within(inspector).getByText("THURSDAY · SOLAR TERM")).toBeTruthy();
    expect(within(inspector).getByText("10月8日")).toBeTruthy();
  });

  it("节日与节气在月格与详情栏里显示（SC-012 / CN-005–006）", () => {
    freezeClock();
    render(<App />);
    const main = screen.getByRole("main");
    const grid = within(main).getByRole("grid", { name: "2026年9月" });

    // 中秋节（2026-09-25）：月格里节日名占农历那一行，格子带语义标记。
    const midAutumn = grid.querySelector('[data-date="2026-09-25"]');
    expect(midAutumn?.querySelector(".cell-semantic")?.textContent).toBe(
      "中秋节",
    );
    expect(midAutumn?.getAttribute("data-china-semantic")).toBe("festival");
    expect(midAutumn?.getAttribute("data-china-backdrop")).toBe(
      "bg.festival.mid-autumn-festival",
    );
    // 节日名取代农历简写（参考图：10 月 6 日只写「中秋节」）。
    expect(midAutumn?.querySelector(".cell-lunar")).toBeNull();

    // 节气（2026-09-23 秋分）：右上角标签 + 农历简写并存。
    const autumnEquinox = grid.querySelector('[data-date="2026-09-23"]');
    expect(autumnEquinox?.querySelector(".cell-solar-term")?.textContent).toBe(
      "秋分",
    );
    expect(autumnEquinox?.querySelector(".cell-lunar")?.textContent).toBe(
      "十三",
    );

    // 详情栏：名称、英文名、序号与一句释义。
    fireEvent.click(midAutumn!);
    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("FRIDAY · FESTIVAL")).toBeTruthy();
    expect(within(inspector).getByText("中秋节")).toBeTruthy();
    expect(within(inspector).getByText("Mid-Autumn Festival")).toBeTruthy();
    expect(
      within(inspector).getByText("八月十五，赏月团圆，食月饼。"),
    ).toBeTruthy();

    // 秋分当天：节气块带序号，且农历行与语义块并存。
    fireEvent.click(autumnEquinox!);
    expect(within(inspector).getByText("WEDNESDAY · SOLAR TERM")).toBeTruthy();
    expect(within(inspector).getByText("秋分")).toBeTruthy();
    expect(within(inspector).getByText("第 18 个节气")).toBeTruthy();
    expect(within(inspector).getByText("农历八月十三")).toBeTruthy();
  });

  it("默认构建不携带图片资源：节日格只有语义文字，没有背景图（SC-013 的 v0.1 口径）", () => {
    freezeClock();
    render(<App />);
    const grid = within(screen.getByRole("main")).getByRole("grid", {
      name: "2026年9月",
    });
    const midAutumn = grid.querySelector('[data-date="2026-09-25"]');

    // 节日 / 节气背景是逻辑引用（SC-012），引用照常落到格子上；能不能画出图片
    // 由资源包决定，而应用装配不传资源包——v0.1 没有可随应用分发的图片许可
    // （SC-022 定的口径，见 third-party-assets.md §1 与 app-spec §9）。
    // 这条断言盯的是**应用装配这一层**：将来接入资源包要从这里开始改
    // （并从本文件与 third-party-assets.md §1、§3 一起登记），而不是让默认构建
    // 在无人察觉的情况下长出图片。徽标一侧的同一条口径由「导入的比赛在月格显示
    // 队标 VS 队标」按 fallback 文本（ARS / MCI）守着，这里不重复。
    expect(midAutumn?.getAttribute("data-china-backdrop")).toBe(
      "bg.festival.mid-autumn-festival",
    );
    expect(midAutumn?.querySelector(".cell-backdrop")).toBeNull();
    expect(midAutumn?.querySelector(".cell-semantic")?.textContent).toBe(
      "中秋节",
    );
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
    // 设置页的选中态就是主题的界面事实（SC-018 起主题控件在这里）。
    const pane = openSettings();
    expect(
      within(pane)
        .getByRole("button", { name: "深色" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("切换主题写入快照设置", async () => {
    mockBackend({ dataStoreRead: seededSnapshot() });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    openSettings();
    fireEvent.click(
      within(settingsPane()).getByRole("button", { name: "深色" }),
    );
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

    // 重复选中当前主题不重复写快照（二值选择，不是切换开关）。
    fireEvent.click(
      within(settingsPane()).getByRole("button", { name: "深色" }),
    );
    await Promise.resolve();
    expect(
      writtenSnapshots().filter(
        (snapshot) =>
          (snapshot.settings as Record<string, unknown>)["app.theme"] !==
          undefined,
      ),
    ).toHaveLength(1);
  });

  it("浏览器预览模式下可切换但不持久化", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());

    // 预览模式在设置页里说清“改动不写入本地设置”（§13）。
    const pane = openSettings();
    expect(within(pane).getByText(/改动不写入本地设置/)).toBeTruthy();

    fireEvent.click(within(pane).getByRole("button", { name: "深色" }));
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
  it("导入后执行匹配：没有可识别的语义时全部回退普通显示", async () => {
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

/** SC-007 集成：订阅地址 → Rust 侧抓取 → 落库 → 月视图 + 订阅行状态。 */
const SUBSCRIBE_URL =
  "https://calendar.example.com/feed.ics?token=SECRET-TOKEN";
const SUBSCRIBE_DISPLAY_NAME = "calendar.example.com/feed.ics";

const SUBSCRIBE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:webcal-evening@example.com",
  "SUMMARY:订阅例会",
  "DTSTART:20260923T190000",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

function webcalOk(
  body = SUBSCRIBE_ICS,
  validators: { etag?: string } = {},
): Record<string, unknown> {
  return {
    status: 200,
    notModified: false,
    body,
    etag: validators.etag ?? null,
    lastModified: null,
  };
}

const WEBCAL_NOT_MODIFIED = {
  status: 304,
  notModified: true,
  body: null,
  etag: null,
  lastModified: null,
};

function sidebar(): HTMLElement {
  return screen.getByRole("complementary", { name: "侧栏" });
}

/** 设置页（SC-018）：v0.1 的偏好设置集中在这里，侧栏只留入口与显示开关。 */
function settingsPane(): HTMLElement {
  return screen.getByRole("region", { name: "设置" });
}

/** 从侧栏打开设置页（ui-design §4 第 5 项）。 */
function openSettings(): HTMLElement {
  fireEvent.click(within(sidebar()).getByRole("button", { name: "设置" }));
  return settingsPane();
}

/** 返回月视图：月历重新成为主区域。 */
function closeSettings() {
  fireEvent.click(
    within(settingsPane()).getByRole("button", {
      name: "返回月视图",
    }),
  );
}

/** 订阅行状态文案（SRC-003）；与 App 的全局提示分开断言。 */
function subscriptionRowStatus(): string {
  return sidebar().querySelector(".source-status")?.textContent ?? "";
}

async function subscribeToFeed(url = SUBSCRIBE_URL) {
  fireEvent.change(within(sidebar()).getByLabelText(/订阅 ICS/), {
    target: { value: url },
  });
  fireEvent.click(within(sidebar()).getByRole("button", { name: "添加" }));
  await waitFor(() =>
    expect(within(sidebar()).getByText(SUBSCRIBE_DISPLAY_NAME)).toBeTruthy(),
  );
}

describe("ICS / WebCal 订阅（SC-007 / SRC-002 / SRC-003 / SRC-004）", () => {
  it("添加订阅后事件进入月视图，来源与缓存校验值写入快照", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await renderReadyApp();
    mockBackend({
      webcalFetch: (args) => {
        calls.push(args);
        return webcalOk(SUBSCRIBE_ICS, { etag: 'W/"v1"' });
      },
    });

    await subscribeToFeed();

    // 抓取走桌面壳命令，首次不带条件校验值。
    expect(calls).toEqual([
      { url: SUBSCRIBE_URL, etag: null, lastModified: null },
    ]);

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    await waitFor(() =>
      expect(
        within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
          "19:00 订阅例会",
        ),
      ).toBeTruthy(),
    );

    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.sources).toEqual([
      expect.objectContaining({
        type: "webcal",
        name: SUBSCRIBE_DISPLAY_NAME,
        enabled: true,
        lastSyncStatus: "ok",
        webcal: expect.objectContaining({
          url: SUBSCRIBE_URL,
          etag: 'W/"v1"',
        }),
      }),
    ]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({ uid: "webcal-evening@example.com" }),
    ]);
    // 地址只存在于本地缓存字段，不进入展示文案。
    expect(within(sidebar()).queryByText(/SECRET-TOKEN/)).toBeNull();
  });

  it("手动刷新带上 ETag，304 时保留缓存并提示无变化", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await renderReadyApp();
    mockBackend({
      webcalFetch: (args) => {
        calls.push(args);
        return calls.length === 1
          ? webcalOk(SUBSCRIBE_ICS, { etag: 'W/"v1"' })
          : WEBCAL_NOT_MODIFIED;
      },
    });
    await subscribeToFeed();

    fireEvent.click(within(sidebar()).getByRole("button", { name: "刷新" }));

    await waitFor(() =>
      expect(within(sidebar()).getByText(/没有变化/)).toBeTruthy(),
    );
    expect(calls[1]).toEqual({
      url: SUBSCRIBE_URL,
      etag: 'W/"v1"',
      lastModified: null,
    });
    expect(writtenSnapshots().at(-1)!.events).toHaveLength(1);
  });

  it("刷新失败保留旧事件与上次成功时间，错误文案不含 token", async () => {
    let attempt = 0;
    await renderReadyApp();
    mockBackend({
      webcalFetch: () => {
        attempt += 1;
        return attempt === 1
          ? webcalOk(SUBSCRIBE_ICS)
          : new Error(`error sending request for url (${SUBSCRIBE_URL})`);
      },
    });
    await subscribeToFeed();

    fireEvent.click(within(sidebar()).getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(subscriptionRowStatus()).toContain("刷新失败"));
    const status = subscriptionRowStatus();
    expect(status).not.toContain("SECRET-TOKEN");
    expect(status).toContain("?…");
    // 失败原因与上次成功时间同时可见（SRC-003）。
    expect(status).toContain("上次成功");

    // 事件与上次成功时间都还在（SRC-004）。
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
        "19:00 订阅例会",
      ),
    ).toBeTruthy();

    const [source] = writtenSnapshots().at(-1)!.sources as Array<
      Record<string, unknown>
    >;
    expect(source.lastSyncStatus).toBe("error");
    expect(source.lastSyncAt).toBeTruthy();
  });

  it("停用订阅后事件从月视图消失，数据保留在快照里", async () => {
    await renderReadyApp();
    mockBackend({ webcalFetch: () => webcalOk(SUBSCRIBE_ICS) });
    await subscribeToFeed();

    // 侧栏数据源行承担「显示 / 隐藏」（SC-018 / ui-design §4 第 2 项）。
    fireEvent.click(within(sidebar()).getByLabelText(SUBSCRIBE_DISPLAY_NAME));

    await waitFor(() => expect(subscriptionRowStatus()).toContain("已停用"));
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).queryByText(
        /订阅例会/,
      ),
    ).toBeNull();

    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.events).toHaveLength(1);
    expect(
      (snapshot.sources as Array<Record<string, unknown>>)[0].enabled,
    ).toBe(false);

    // 重新显示后事件回到月视图。
    fireEvent.click(within(sidebar()).getByLabelText(SUBSCRIBE_DISPLAY_NAME));
    await waitFor(() =>
      expect(
        within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
          "19:00 订阅例会",
        ),
      ).toBeTruthy(),
    );
  });

  it("删除订阅时确认后级联删除来源与事件", async () => {
    await renderReadyApp();
    mockBackend({ webcalFetch: () => webcalOk(SUBSCRIBE_ICS) });
    await subscribeToFeed();

    // 删除是需要确认的管理动作，集中在设置页的数据源一节（SC-018）。
    const pane = openSettings();
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    fireEvent.click(within(pane).getByRole("button", { name: "删除" }));
    expect(within(pane).getByText(SUBSCRIBE_DISPLAY_NAME)).toBeTruthy();

    confirmMock.mockReturnValue(true);
    fireEvent.click(within(pane).getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(within(pane).queryByText(SUBSCRIBE_DISPLAY_NAME)).toBeNull(),
    );
    expect(within(sidebar()).queryByText(SUBSCRIBE_DISPLAY_NAME)).toBeNull();
    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.events).toEqual([]);
  });

  it("非法地址不创建来源，并保留输入内容供修正", async () => {
    await renderReadyApp();
    mockBackend({ webcalFetch: () => webcalOk() });

    fireEvent.change(within(sidebar()).getByLabelText(/订阅 ICS/), {
      target: { value: "ftp://example.com/feed.ics" },
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(
        within(sidebar()).getByText(/只支持 http \/ https \/ webcal 地址/),
      ).toBeTruthy(),
    );
    expect(
      (within(sidebar()).getByLabelText(/订阅 ICS/) as HTMLInputElement).value,
    ).toBe("ftp://example.com/feed.ics");
    expect(writtenSnapshots().at(-1)!.sources).toEqual([]);
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "webcal_fetch"),
    ).toHaveLength(0);
  });

  it("预览模式下订阅给出降级提示，不发起网络请求", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());

    fireEvent.change(within(sidebar()).getByLabelText(/订阅 ICS/), {
      target: { value: SUBSCRIBE_URL },
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(within(sidebar()).getByText(/订阅需要桌面环境/)).toBeTruthy(),
    );
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "webcal_fetch"),
    ).toHaveLength(0);
  });
});

/** SC-016 集成：关注球队 → 持久化；比赛 ICS → 比赛月格 → Matchday Inspector。 */
const MATCH_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:match-1@example.com",
  "SUMMARY:Arsenal vs Manchester City",
  "LOCATION:Emirates Stadium",
  "DTSTART:20260926T233000",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

/**
 * 设置键按字面量写：这里是持久化格式的断言点——键名被改名时，
 * 旧快照里的关注状态会读不出来，而只引用常量的话这种回归测不出来。
 */
const FOLLOWED_TEAMS_KEY = "football.followedTeams";

function followedTeamsInSnapshot(): unknown {
  const settings = writtenSnapshots().at(-1)!.settings as Record<
    string,
    unknown
  >;
  return settings[FOLLOWED_TEAMS_KEY];
}

function teamCheckbox(name: RegExp): HTMLInputElement {
  return within(sidebar()).getByLabelText(name) as HTMLInputElement;
}

describe("关注球队（SC-016 / SPORT-006）", () => {
  it("关注状态从快照恢复：勾选与计数都来自持久化设置", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [FOLLOWED_TEAMS_KEY]: ["arsenal"] }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    expect(within(sidebar()).getByText("已关注 1 支")).toBeTruthy();
    expect(teamCheckbox(/阿森纳/).checked).toBe(true);
    expect(teamCheckbox(/曼城/).checked).toBe(false);
    // 可关注球队来自元数据层，UI 不做球队名匹配。
    expect(
      within(sidebar()).getAllByRole("checkbox").length,
    ).toBeGreaterThanOrEqual(20);
  });

  it("关注 / 取消关注写入快照，按名单顺序规范化", async () => {
    await renderReadyApp();
    expect(within(sidebar()).getByText("未选择")).toBeTruthy();

    fireEvent.click(teamCheckbox(/曼城/));
    await waitFor(() =>
      expect(followedTeamsInSnapshot()).toEqual(["manchester-city"]),
    );

    fireEvent.click(teamCheckbox(/阿森纳/));
    await waitFor(() =>
      expect(followedTeamsInSnapshot()).toEqual(["arsenal", "manchester-city"]),
    );

    fireEvent.click(teamCheckbox(/曼城/));
    await waitFor(() => expect(followedTeamsInSnapshot()).toEqual(["arsenal"]));
    expect(teamCheckbox(/阿森纳/).checked).toBe(true);
  });

  it("快照里的坏值不会变成关注状态（不猜）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({
        [FOLLOWED_TEAMS_KEY]: ["not-a-team", 42],
      }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    expect(within(sidebar()).getByText("未选择")).toBeTruthy();
    // 只看球队复选框：侧栏数据源行还有内置来源的显示开关（SC-018）。
    const teamBoxes = sidebar().querySelectorAll<HTMLInputElement>(
      ".followed-team-check",
    );
    expect(teamBoxes.length).toBeGreaterThan(0);
    expect([...teamBoxes].some((box) => box.checked)).toBe(false);
  });
});

describe("比赛月格与 Matchday Inspector（SC-016 / SPORT-004 / SPORT-005）", () => {
  it("导入的比赛在月格显示队标 VS 队标，点击后进入比赛详情", async () => {
    await renderReadyApp();
    await importMatchIcs();

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    const cell = grid.querySelector('[data-date="2026-09-26"]') as HTMLElement;
    // 格内只有队标 VS 队标与联赛背景，标题 / 时间不进格子（§10.2）。
    expect(
      [...cell.querySelectorAll(".match-cell .mark")].map(
        (mark) => mark.textContent,
      ),
    ).toEqual(["ARS", "MCI"]);
    expect(cell.querySelector(".match-cell-vs")?.textContent).toBe("VS");
    expect(cell.querySelector(".match-cell-bg")?.textContent).toBe("英超");
    expect(cell.textContent).not.toContain("Arsenal");
    expect(cell.textContent).not.toContain("23:30");

    fireEvent.click(cell);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText(/SATURDAY · MATCHDAY/)).toBeTruthy();
    const match = within(inspector).getByRole("region", {
      name: "阿森纳 对 曼城",
    });
    expect(within(match).getByText("Arsenal")).toBeTruthy();
    // 联赛短标签：正文一行 + 低透明度背景水印（§13.2）。
    expect(match.querySelector(".matchday-competition")?.textContent).toBe(
      "英超",
    );
    expect(within(match).getByText("23:30")).toBeTruthy();
    expect(within(match).getByText("Emirates Stadium")).toBeTruthy();
    expect(within(match).getByText("赛前 30 分钟")).toBeTruthy();
    expect(within(match).getByText("建议提醒")).toBeTruthy();
    // 天气在 v0.1 没有可靠来源：不显示伪造值。
    expect(match.textContent).not.toContain("天气");
  });

  it("关注的球队在比赛详情里带标记（SPORT-006 的可见效果）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [FOLLOWED_TEAMS_KEY]: ["arsenal"] }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    await importMatchIcs();
    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-26"]') as HTMLElement,
    );

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    const match = within(inspector).getByRole("region", {
      name: "阿森纳 对 曼城",
    });
    expect(within(match).getAllByText("关注")).toHaveLength(1);
    expect(
      match.querySelectorAll(".matchday-followed")[0].closest(".matchday-team")
        ?.textContent,
    ).toContain("阿森纳");
  });

  it("普通标题导入后仍按普通事件显示，不进入比赛模式", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS, "plain.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-23"]') as HTMLElement,
    );

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(inspector.querySelector(".matchday")).toBeNull();
    expect(inspector.hasAttribute("data-matchday")).toBe(false);
    expect(within(inspector).getByText("19:00")).toBeTruthy();
  });
});

describe("月格与详情栏的农历（SC-010 / CN-001）", () => {
  it("月格显示农历简写：初一显示月名（月份边界），其余显示日名", () => {
    freezeClock();
    render(<App />);

    const grid = within(screen.getByRole("main")).getByRole("grid", {
      name: "2026年9月",
    });
    const lunarOf = (dateKey: string) =>
      grid.querySelector(`[data-date="${dateKey}"] .cell-lunar`)?.textContent;

    // 2026 年八月初一 = 9 月 11 日（官方对照表），前后两天分别属于七月与八月。
    expect(lunarOf("2026-09-10")).toBe("廿九");
    expect(lunarOf("2026-09-11")).toBe("八月");
    expect(lunarOf("2026-09-23")).toBe("十三");
    // 跨月格（8 月 31 日）同样有农历，只是视觉上弱化。
    expect(lunarOf("2026-08-31")).toBe("十九");
  });

  it("详情栏显示选中日期的农历，随选择更新", () => {
    freezeClock();
    render(<App />);

    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("农历八月十三")).toBeTruthy();

    const grid = within(screen.getByRole("main")).getByRole("grid", {
      name: "2026年9月",
    });
    fireEvent.click(grid.querySelector('[data-date="2026-10-01"]')!);

    expect(within(inspector).getByText("农历八月廿一")).toBeTruthy();
    expect(within(inspector).queryByText("农历八月十三")).toBeNull();
  });

  it("日历农历随月份导航重算", () => {
    freezeClock();
    render(<App />);

    const main = screen.getByRole("main");
    fireEvent.click(within(main).getByRole("button", { name: "下一月" }));

    const grid = within(main).getByRole("grid", { name: "2026年10月" });
    expect(
      grid.querySelector('[data-date="2026-10-10"] .cell-lunar')?.textContent,
    ).toBe("九月");
  });
});

describe("详情栏的休假 / 补班语义（SC-011 / CN-002–004）", () => {
  it("选中放假日显示大字、假期名与连休位置", () => {
    freezeClock();
    render(<App />);

    // 2026 年中秋节：9 月 25 日至 27 日（国办发明电〔2025〕7号）。
    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-25"]') as HTMLElement,
    );

    const row = document.querySelector(".inspector-china-day") as HTMLElement;
    expect(row.getAttribute("data-china-day")).toBe("rest");
    expect(row.textContent).toContain("休");
    expect(row.textContent).toContain("中秋节假期");
    expect(row.textContent).toContain("第 1 天 / 共 3 天");
  });

  it("选中补班日显示补班语义，与休假的标记不同", () => {
    freezeClock();
    render(<App />);

    // 2026 年国庆节前的补班日：9 月 20 日（周日）上班。
    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-20"]') as HTMLElement,
    );

    const row = document.querySelector(".inspector-china-day") as HTMLElement;
    expect(row.getAttribute("data-china-day")).toBe("makeup");
    expect(row.textContent).toContain("补");
    expect(row.textContent).toContain("国庆节补班日");
    expect(row.textContent).not.toContain("共 3 天");
  });

  it("普通日期不显示该行", () => {
    freezeClock();
    render(<App />);

    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-23"]') as HTMLElement,
    );

    expect(document.querySelector(".inspector-china-day")).toBeNull();
  });

  it("月格挂上休假 / 补班标记，连休在 DOM 里就是连续区段（CN-004）", () => {
    freezeClock();
    render(<App />);

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    const cellOf = (dateKey: string) =>
      grid.querySelector(`[data-date="${dateKey}"]`) as HTMLElement;

    // 中秋 9 月 25 日至 27 日：三天共享同一个区段 id。
    expect(cellOf("2026-09-25").getAttribute("data-china-day")).toBe("rest");
    expect(cellOf("2026-09-26").getAttribute("data-china-run")).toBe(
      "2026-09-25",
    );
    expect(cellOf("2026-09-27").getAttribute("data-china-run")).toBe(
      "2026-09-25",
    );

    // 补班日（9 月 20 日）是另一种类别，没有区段。
    expect(cellOf("2026-09-20").getAttribute("data-china-day")).toBe("makeup");
    expect(cellOf("2026-09-20").hasAttribute("data-china-run")).toBe(false);

    // 普通日期不挂标记。
    expect(cellOf("2026-09-23").hasAttribute("data-china-day")).toBe(false);
  });
});

const CLOSE_BEHAVIOR_KEY = "app.closeBehavior";

/** 推给桌面壳的关闭行为序列（Rust 侧才是执行者）。 */
function pushedCloseBehaviors(): unknown[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "shell_set_close_behavior")
    .map(([, args]) => (args as { behavior?: unknown } | undefined)?.behavior);
}

/** 最近一次写入快照里的某个设置值。 */
function settingInSnapshot(key: string): unknown {
  const settings = writtenSnapshots().at(-1)!.settings as Record<
    string,
    unknown
  >;
  return settings[key];
}

function closeBehaviorInSnapshot(): unknown {
  return settingInSnapshot(CLOSE_BEHAVIOR_KEY);
}

function closeBehaviorButton(name: string): HTMLElement {
  return within(settingsPane()).getByRole("button", { name });
}

describe("窗口行为（SC-002）", () => {
  it("默认隐藏到托盘，并在启动时推给桌面壳", async () => {
    await renderReadyApp();
    const pane = openSettings();

    const option = closeBehaviorButton("隐藏到托盘");
    expect(option.getAttribute("aria-pressed")).toBe("true");
    expect(closeBehaviorButton("退出应用").getAttribute("aria-pressed")).toBe(
      "false",
    );
    // 说明文案写清“应用是否还在运行”，不靠颜色单独表达。
    expect(within(pane).getByText(/继续在系统托盘运行/)).toBeTruthy();
    // 托盘可用时不应出现降级提示。
    expect(within(pane).queryByText(/系统托盘不可用/)).toBeNull();
    expect(pushedCloseBehaviors()).toEqual(["hide-to-tray"]);
  });

  it("快照里的退出设置在启动时恢复，并推给桌面壳", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [CLOSE_BEHAVIOR_KEY]: "quit" }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    openSettings();
    expect(closeBehaviorButton("退出应用").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(pushedCloseBehaviors()).toEqual(["quit"]);
  });

  it("坏值按默认行为处理，不猜出第三种语义", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [CLOSE_BEHAVIOR_KEY]: "minimize" }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    openSettings();
    expect(closeBehaviorButton("隐藏到托盘").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(pushedCloseBehaviors()).toEqual(["hide-to-tray"]);
  });

  it("切换关闭行为写入快照并推送桌面壳", async () => {
    await renderReadyApp();
    openSettings();

    fireEvent.click(closeBehaviorButton("退出应用"));

    await waitFor(() => expect(closeBehaviorInSnapshot()).toBe("quit"));
    expect(pushedCloseBehaviors()).toEqual(["hide-to-tray", "quit"]);
    expect(closeBehaviorButton("退出应用").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("桌面壳把隐藏降级为退出时（托盘不可用）说明真实行为（§13）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot(),
      shellSetCloseBehavior: { behavior: "quit", trayAvailable: false },
    });
    render(<App />);

    await waitFor(() =>
      expect(
        within(openSettings()).getByText(
          /系统托盘不可用：关闭窗口将直接退出应用/,
        ),
      ).toBeTruthy(),
    );
    // 设置值仍是用户选的“隐藏到托盘”，降级只发生在执行侧。
    expect(closeBehaviorButton("隐藏到托盘").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("桌面壳拒绝推送时给出可解释状态，但不影响持久化（§13）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot(),
      shellSetCloseBehavior: new Error("未知的关闭行为：exit"),
    });
    render(<App />);

    await waitFor(() =>
      expect(
        within(openSettings()).getByText(/关闭行为未能应用：未知的关闭行为/),
      ).toBeTruthy(),
    );

    // 失败的是执行侧：设置照常落盘，下次启动仍会按用户选择推送。
    fireEvent.click(closeBehaviorButton("退出应用"));
    await waitFor(() => expect(closeBehaviorInSnapshot()).toBe("quit"));
  });
});

/** SC-017 集成：两场比赛，用来验证“重启后未触发的提醒仍会触发”。 */
const TWO_MATCHES_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:match-a@example.com",
  "SUMMARY:Arsenal vs Manchester City",
  "DTSTART:20260926T233000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:match-b@example.com",
  "SUMMARY:Liverpool vs Chelsea",
  "DTSTART:20260927T200000",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

/** 通知设置键按字面量写：键名被改名时旧快照会读不出设置（与 SC-016 同一口径）。 */
const MATCH_REMINDER_KEY = "notifications.matchReminderMinutes";
const NOTIFICATIONS_ENABLED_KEY = "notifications.enabled";
const FIRED_REMINDERS_KEY = "notifications.firedReminders";

describe("本地通知与提醒调度（SC-017 / NOTIFY-001–004）", () => {
  it("比赛按默认建议（赛前 30 分钟）弹出本地通知，并把去重状态写入快照", async () => {
    await renderReadyApp();
    await importMatchIcs();

    // 设置页此刻已经能说明下一条提醒（app-spec §12 可解释状态）。
    const pane = openSettings();
    await waitFor(() =>
      expect(within(pane).getByText(/下一条提醒/)).toBeTruthy(),
    );
    expect(sentNotifications()).toEqual([]);

    // 比赛 2026-09-26 23:30，默认提前 30 分钟。
    await advanceTo(2026, 9, 26, 22, 59);
    expect(sentNotifications()).toEqual([]);

    await advanceTo(2026, 9, 26, 23, 0);
    expect(sentNotifications()).toEqual([
      {
        title: "Arsenal vs Manchester City",
        body: expect.stringContaining("赛前 30 分钟"),
      },
    ]);

    // 去重日志（NOTIFY-004）与“已发送”的事实一起落盘。
    await waitFor(() =>
      expect(snapshotSettings()[FIRED_REMINDERS_KEY]).toHaveLength(1),
    );
    expect(snapshotSettings()[FIRED_REMINDERS_KEY]).toEqual([
      expect.objectContaining({ outcome: "fired" }),
    ]);
  });

  it("重启后已触发的提醒不重复、未触发的照常触发（NOTIFY-004）", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(TWO_MATCHES_ICS, "two-matches.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    // 第一场 2026-09-26 23:30 → 23:00 触发；第二场次日 20:00 → 19:30 触发。
    await advanceTo(2026, 9, 26, 23, 0);
    expect(sentNotifications().map((entry) => entry.title)).toEqual([
      "Arsenal vs Manchester City",
    ]);

    // 重启：用同一份快照重新启动应用（去重日志随快照一起恢复）。
    const snapshot = JSON.stringify(writtenSnapshots().at(-1));
    cleanup();
    mockBackend({ dataStoreRead: snapshot });
    freezeClock();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/本地数据层就绪/)).toBeTruthy(),
    );
    expect(sentNotifications()).toHaveLength(1);

    // 已触发的那场不会重复弹；还没到点的那场仍然会弹（待触发提醒被恢复）。
    await advanceTo(2026, 9, 27, 19, 29);
    expect(sentNotifications()).toHaveLength(1);
    await advanceTo(2026, 9, 27, 19, 30);
    expect(sentNotifications().map((entry) => entry.title)).toEqual([
      "Arsenal vs Manchester City",
      "Liverpool vs Chelsea",
    ]);
  });

  it("用户设置的提前量优先（NOTIFY-003），并写回快照", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [MATCH_REMINDER_KEY]: 60 }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    await importMatchIcs();

    // 提醒时间：23:30 前 60 分钟 → 22:30。
    await advanceTo(2026, 9, 26, 22, 29);
    expect(sentNotifications()).toEqual([]);
    await advanceTo(2026, 9, 26, 22, 30);
    expect(sentNotifications()).toEqual([
      {
        title: "Arsenal vs Manchester City",
        body: expect.stringContaining("赛前 60 分钟"),
      },
    ]);

    // 详情栏的提醒行与调度同口径：写明来源是用户设置。
    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-26"]') as HTMLElement,
    );
    const match = within(
      screen.getByRole("complementary", { name: "详情栏" }),
    ).getByRole("region", { name: "阿森纳 对 曼城" });
    expect(within(match).getByText("提醒")).toBeTruthy();
    expect(within(match).getByText(/赛前 60 分钟（用户设置）/)).toBeTruthy();
  });

  it("选择“不提醒”后不再弹出，并在详情栏说明原因", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [MATCH_REMINDER_KEY]: null }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    await importMatchIcs();
    await advanceTo(2026, 9, 27, 0, 0);

    expect(sentNotifications()).toEqual([]);
    fireEvent.click(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-26"]') as HTMLElement,
    );
    const match = within(
      screen.getByRole("complementary", { name: "详情栏" }),
    ).getByRole("region", { name: "阿森纳 对 曼城" });
    expect(within(match).getByText("已关闭（用户设置）")).toBeTruthy();
  });

  it("通知开关与比赛提醒提前量写入快照", async () => {
    await renderReadyApp();
    const pane = openSettings();

    fireEvent.click(within(pane).getByLabelText("日历提醒"));
    await waitFor(() =>
      expect(snapshotSettings()[NOTIFICATIONS_ENABLED_KEY]).toBe(false),
    );

    fireEvent.change(within(pane).getByLabelText("比赛提醒提前量"), {
      target: { value: "15" },
    });
    await waitFor(() =>
      expect(snapshotSettings()[MATCH_REMINDER_KEY]).toBe(15),
    );
  });

  it("权限被拒绝时解释状态，日历继续可用（§13）", async () => {
    mockBackend({ notificationStatus: { permission: "denied" } });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    const pane = openSettings();
    expect(within(pane).getByText(/系统通知权限被拒绝/)).toBeTruthy();
    expect(
      within(pane).getByRole("button", { name: "请求系统授权" }),
    ).toBeTruthy();
    // 日历本身继续可用：返回月视图后网格照常渲染。
    closeSettings();
    expect(screen.getByRole("grid", { name: "2026年9月" })).toBeTruthy();
  });

  it("发送失败时给出可解释状态，且同一提醒不再重复", async () => {
    mockBackend({
      notificationSend: Object.assign(new Error("系统拒绝"), {
        kind: "send-failed",
      }),
    });
    await renderReadyApp();
    await importMatchIcs();

    await advanceTo(2026, 9, 26, 23, 0);
    await waitFor(() =>
      expect(within(openSettings()).getByText(/系统通知未能弹出/)).toBeTruthy(),
    );
    expect(sentNotifications()).toHaveLength(1);

    // 已记为已处理：继续推进时间不会再弹（NOTIFY-004）。
    await advanceTo(2026, 9, 26, 23, 10);
    expect(sentNotifications()).toHaveLength(1);
  });

  it("浏览器预览模式：说明系统通知需要桌面环境", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);
    await waitFor(() =>
      expect(
        within(openSettings()).getByText(/系统通知需要桌面环境/),
      ).toBeTruthy(),
    );
  });
});

/**
 * SC-018 集成：设置页把 v0.1 的偏好集中到一处，并保证开关真的改变展示。
 *
 * 设置键按字面量写：键名被改名时旧快照会读不出设置（与 SC-016 / SC-017 同一口径）。
 */
const BUILTIN_HIDDEN_KEY = "sources.builtinHidden";
const WEBCAL_INTERVAL_KEY = "webcal.refreshIntervalMinutes";

/**
 * 侧栏 / 设置页里某个内置来源的显示勾选框（同一份设置的两个入口）。
 * 设置页的勾选框标签里带着说明文案，因此按子串匹配。
 */
function builtinCheckbox(pane: HTMLElement, name: string): HTMLInputElement {
  return within(pane).getByLabelText(name, {
    exact: false,
  }) as HTMLInputElement;
}

/** 选中日期并返回月格。 */
function selectDate(dateKey: string): HTMLElement {
  const grid = screen.getByRole("grid", { name: "2026年9月" });
  const cell = grid.querySelector(`[data-date="${dateKey}"]`) as HTMLElement;
  fireEvent.click(cell);
  return grid;
}

/** 导入一场英超比赛，等到事件真的进了界面（这一组好几条用例都要先有比赛数据）。 */
async function importMatchIcs() {
  chooseImportFile(icsFile(MATCH_ICS, "matches.ics"));
  await waitFor(() => expect(screen.getByText(/新增 1/)).toBeTruthy());
}

describe("设置页（SC-018 / app-spec §9 SETTINGS）", () => {
  it("设置入口打开设置页：月历暂时让位，返回后回到原来的状态（P-05）", () => {
    freezeClock();
    render(<App />);

    const entry = within(sidebar()).getByRole("button", { name: "设置" });
    expect(entry.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(entry);

    const pane = settingsPane();
    expect(entry.getAttribute("aria-pressed")).toBe("true");
    // 月历是主界面：设置页是临时页面，打开时不渲染月视图。
    expect(screen.queryByRole("grid", { name: "2026年9月" })).toBeNull();
    // 三栏结构不变：侧栏与详情栏仍在。
    expect(sidebar()).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "详情栏" })).toBeTruthy();
    // 只有这几节，没有统计 / 推荐之类的新首页内容。
    for (const heading of [
      "外观",
      "区域",
      "数据源",
      "关注球队",
      "通知",
      "关闭窗口时",
      "关于",
    ]) {
      expect(within(pane).getByRole("heading", { name: heading })).toBeTruthy();
    }

    closeSettings();
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      grid
        .querySelector('[data-date="2026-09-23"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("区域一节陈述当前固定取值，且不写入设置键（预留）", async () => {
    await renderReadyApp();
    const pane = openSettings();

    expect(within(pane).getByText("简体中文")).toBeTruthy();
    expect(within(pane).getByText("一周起始")).toBeTruthy();
    expect(within(pane).getByText("周一")).toBeTruthy();
    expect(within(pane).getByText(/不写入任何设置键/)).toBeTruthy();

    // 改其他设置时不会顺手写出区域键（预留不等于写一个没人读的值）。
    fireEvent.click(within(pane).getByRole("button", { name: "深色" }));
    await waitFor(() => expect(settingInSnapshot("app.theme")).toBe("dark"));
    expect(
      Object.keys(snapshotSettings()).filter((key) => key.startsWith("app.")),
    ).toEqual(expect.arrayContaining(["app.lastOpenedAt", "app.theme"]));
    expect(
      Object.keys(snapshotSettings()).filter(
        (key) => key.startsWith("app.locale") || key.startsWith("app.timezone"),
      ),
    ).toEqual([]);
  });

  it("关于一节给出名称、版本与 License，且不写入设置键（SC-022）", async () => {
    await renderReadyApp();
    const pane = openSettings();

    // 名称策略：界面给的是一对名字，中文名与侧栏品牌同源（settings/app-info）。
    expect(
      within(pane).getByText(`${APP_NAME_ZH} / ${APP_NAME_EN}`),
    ).toBeTruthy();
    // 版本来自构建期注入（package.json → vite define），不是写死的字符串。
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(within(pane).getByText(APP_VERSION)).toBeTruthy();
    expect(within(pane).getByText(APP_LICENSE)).toBeTruthy();

    // 这一节是只读事实：打开设置只会写入「最近打开时间」这一条既有键，
    // 不会为「关于」多出任何设置键（新增键会让这条断言变红）。
    expect(
      Object.keys(snapshotSettings())
        .filter((key) => key.startsWith("app."))
        .sort(),
    ).toEqual(["app.lastOpenedAt"]);
  });

  it("关闭「中国节假日」：休 / 补语义立即消失，设置写入快照，重开立即恢复", async () => {
    await renderReadyApp();
    const grid = selectDate("2026-09-25");

    // 初始：中秋节假期（9 月 25–27 日）在月格与详情栏都有标记。
    expect(
      grid
        .querySelector('[data-date="2026-09-25"]')
        ?.getAttribute("data-china-day"),
    ).toBe("rest");
    expect(document.querySelector(".inspector-china-day")).toBeTruthy();

    const pane = openSettings();
    fireEvent.click(builtinCheckbox(pane, "中国节假日"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual(["cn-holiday"]),
    );
    closeSettings();

    const gatedGrid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      gatedGrid
        .querySelector('[data-date="2026-09-25"]')
        ?.hasAttribute("data-china-day"),
    ).toBe(false);
    expect(document.querySelector(".inspector-china-day")).toBeNull();

    // 关闭不删数据：重新打开立即恢复（同一份载荷，不需要重新导入）。
    const reopened = openSettings();
    fireEvent.click(builtinCheckbox(reopened, "中国节假日"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual([]),
    );
    closeSettings();
    expect(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelector('[data-date="2026-09-25"]')
        ?.getAttribute("data-china-day"),
    ).toBe("rest");
  });

  it("关闭「二十四节气」：节日与节气语义从月格与详情栏消失", async () => {
    await renderReadyApp();
    selectDate("2026-09-25");
    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(within(inspector).getByText("中秋节")).toBeTruthy();

    const pane = openSettings();
    fireEvent.click(builtinCheckbox(pane, "二十四节气"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual(["solar-terms"]),
    );
    closeSettings();

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      grid.querySelector('[data-date="2026-09-25"] .cell-semantic'),
    ).toBeNull();
    expect(
      grid.querySelector('[data-date="2026-09-23"] .cell-solar-term'),
    ).toBeNull();
    // 农历不属于这个开关（SC-010 是月格的基线内容）。
    expect(
      grid.querySelector('[data-date="2026-09-23"] .cell-lunar')?.textContent,
    ).toBe("十三");

    const gatedInspector = screen.getByRole("complementary", {
      name: "详情栏",
    });
    expect(gatedInspector.querySelector(".inspector-day-semantics")).toBeNull();
    expect(within(gatedInspector).getByText("农历八月十五")).toBeTruthy();
  });

  it("关闭「英超赛程」：比赛回到普通事件显示，识别结果仍在快照里", async () => {
    await renderReadyApp();
    await importMatchIcs();
    selectDate("2026-09-26");

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      grid.querySelector('[data-date="2026-09-26"] .match-cell'),
    ).toBeTruthy();

    const pane = openSettings();
    fireEvent.click(builtinCheckbox(pane, "英超赛程"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual(["premier-league"]),
    );
    closeSettings();

    // 月格：没有对阵块与联赛视觉，回到普通摘要（SEM-003 同一口径）。
    const gatedGrid = screen.getByRole("grid", { name: "2026年9月" });
    const cell = gatedGrid.querySelector(
      '[data-date="2026-09-26"]',
    ) as HTMLElement;
    expect(cell.querySelector(".match-cell")).toBeNull();
    // 联赛视觉让位（这一天在中秋假期里，主背景回到假期底色）。
    expect(cell.getAttribute("data-cell-backdrop")).not.toBe("league");
    expect(
      within(cell).getByText("23:30 Arsenal vs Manchester City"),
    ).toBeTruthy();

    // 详情栏：没有比赛详情，事件列在普通事件区。
    const inspector = screen.getByRole("complementary", { name: "详情栏" });
    expect(inspector.querySelector(".matchday")).toBeNull();
    expect(
      within(inspector).getByText("Arsenal vs Manchester City"),
    ).toBeTruthy();

    // 识别结果与事件都在数据层：增强分区仍记着这场比赛（P-04 只管显示）。
    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.events).toHaveLength(1);
    expect(
      Object.values(
        snapshot.enrichments as Record<string, { semantic?: unknown }>,
      )[0].semantic,
    ).toMatchObject({ type: "sport.fixture" });
  });

  it("关闭「我的日历」：用户事件不进月视图，数据保留在快照里", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS, "team.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());
    selectDate("2026-09-23");
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(within(grid).getByText("19:00 晚间例会")).toBeTruthy();

    const pane = openSettings();
    fireEvent.click(builtinCheckbox(pane, "我的日历"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual(["mine"]),
    );
    closeSettings();

    const gatedGrid = screen.getByRole("grid", { name: "2026年9月" });
    expect(within(gatedGrid).queryByText("19:00 晚间例会")).toBeNull();
    // 内置语义日期不受影响：农历与节气照常显示。
    expect(
      gatedGrid.querySelector('[data-date="2026-09-23"] .cell-solar-term')
        ?.textContent,
    ).toBe("秋分");
    // 事件与来源都留在快照里（停用不删除用户数据）。
    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.sources).toHaveLength(1);
  });

  it("关闭「英超赛程」后比赛不再按比赛提醒（提醒计划读同一份过滤结果）", async () => {
    // 用户设置过提前量时，比赛提醒来自用户设置而不是 Resolver 建议——
    // 只过滤展示元数据的话这条提醒仍会弹，与界面上的承诺矛盾。
    mockBackend({
      dataStoreRead: seededSnapshot({ [MATCH_REMINDER_KEY]: 60 }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    await importMatchIcs();
    const pane = openSettings();
    await waitFor(() =>
      expect(within(pane).getByText(/下一条提醒/)).toBeTruthy(),
    );

    fireEvent.click(builtinCheckbox(pane, "英超赛程"));
    await waitFor(() =>
      expect(settingInSnapshot(BUILTIN_HIDDEN_KEY)).toEqual(["premier-league"]),
    );
    closeSettings();

    // 比赛 2026-09-26 23:30，提前 60 分钟 —— 关闭来源后到点也不弹。
    await advanceTo(2026, 9, 26, 22, 30);
    await advanceTo(2026, 9, 26, 23, 30);
    expect(sentNotifications()).toEqual([]);
    // 事件本身还在（关掉的是视图与提醒，不是数据）。
    expect(writtenSnapshots().at(-1)!.events).toHaveLength(1);
  });

  it("内置来源开关与刷新间隔从快照恢复，坏值按默认处理", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({
        [BUILTIN_HIDDEN_KEY]: ["cn-holiday", "not-a-source", 42],
        [WEBCAL_INTERVAL_KEY]: 120,
      }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    expect(builtinCheckbox(sidebar(), "中国节假日").checked).toBe(false);
    expect(builtinCheckbox(sidebar(), "英超赛程").checked).toBe(true);

    const pane = openSettings();
    // 表外数字（120 分钟）不猜：回到默认 6 小时。
    expect(
      (within(pane).getByLabelText("WebCal 刷新间隔") as HTMLSelectElement)
        .value,
    ).toBe("360");
  });

  it("WebCal 刷新间隔改小后立即按新间隔唤醒（不需要重启）", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await renderReadyApp();
    mockBackend({
      webcalFetch: (args) => {
        calls.push(args);
        return webcalOk(SUBSCRIBE_ICS);
      },
    });
    await subscribeToFeed();
    expect(calls).toHaveLength(1);

    // 默认 6 小时：过去 1 小时不会触发后台刷新。
    await advanceTo(2026, 9, 23, 13, 0);
    expect(calls).toHaveLength(1);

    const pane = openSettings();
    fireEvent.change(within(pane).getByLabelText("WebCal 刷新间隔"), {
      target: { value: "180" },
    });
    await waitFor(() =>
      expect(settingInSnapshot(WEBCAL_INTERVAL_KEY)).toBe(180),
    );
    closeSettings();

    // 距上次检查 2 小时 59 分：还没到 3 小时。
    await advanceTo(2026, 9, 23, 14, 59);
    expect(calls).toHaveLength(1);
    // 到点后按新间隔刷新（改设置不需要重建调度器）。
    await advanceTo(2026, 9, 23, 15, 1);
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
  });

  it("设置页能管理导入来源：最近刷新状态 + 删除（级联）", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS, "team.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    const pane = openSettings();
    // 本地导入来源也在设置页可查，状态与侧栏同一条口径（SRC-003）。
    expect(within(pane).getByText("team.ics")).toBeTruthy();
    expect(within(pane).getByText(/上次成功/)).toBeTruthy();

    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    fireEvent.click(within(pane).getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(within(pane).queryByText("team.ics")).toBeNull(),
    );
    expect(within(sidebar()).queryByText("team.ics")).toBeNull();
    expect(writtenSnapshots().at(-1)!.events).toEqual([]);
  });

  it("设置页只有声明的几节，且不出现事件内容（验收：不是 Dashboard）", async () => {
    await renderReadyApp();
    await importMatchIcs();

    const pane = openSettings();

    // 小节清单写死：新增一节（统计 / 推荐 / 概览 / 图表）会让这条变红，
    // 那时需要一次明确的决定——设置页是偏好页，不是首页。
    expect(
      within(pane)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "外观",
      "区域",
      "数据源",
      "关注球队",
      "通知",
      "关闭窗口时",
      "关于",
    ]);

    // 数据在月视图与详情栏，不在这里汇总：月格与事件摘要都不出现。
    expect(pane.querySelector('[role="grid"]')).toBeNull();
    expect(pane.querySelector(".month-cell")).toBeNull();
    expect(pane.querySelector(".cell-events")).toBeNull();

    // 事件文本只允许出现一处，而且必须是「下一条提醒」那一行——§12 要求状态
    // 可解释（为什么没提醒 / 下一条什么时候来），它是状态而不是事件列表。
    // 哪天这里变多，说明设置页开始汇总用户数据了。
    const titleMentions = within(pane).getAllByText(/vs Manchester City/);
    expect(titleMentions).toHaveLength(1);
    expect(
      titleMentions[0].closest("[data-notification-permission]"),
    ).not.toBeNull();

    // 另一头：这里没有「需要重启」的文案——当前没有需要重启的设置，界面也不该
    // 承诺；真出现那样一条设置时，这条断言要被换成一条真的提示（验收的第 2 半句）。
    expect(within(pane).queryByText(/重启/)).toBeNull();
  });

  it("网络来源在设置页给出最近刷新状态，与侧栏同一句话（验收 5）", async () => {
    await renderReadyApp();
    mockBackend({ webcalFetch: () => webcalOk(SUBSCRIBE_ICS) });
    await subscribeToFeed();

    const pane = openSettings();
    const row = within(pane).getByText(SUBSCRIBE_DISPLAY_NAME).closest("li")!;
    const rowStatus = (): string =>
      row.querySelector(".source-status")?.textContent ?? "";

    // 网络来源在设置页仍有刷新入口（管理动作集中在这里）。
    expect(within(row).getByRole("button", { name: "刷新" })).toBeTruthy();
    expect(rowStatus()).toContain("上次成功");
    // 与侧栏逐字相同：两处共用 source-display，说法不会各自漂移。同一句话里
    // 也不含订阅地址——脱敏在落库前就做完了，两处界面都只是照读。
    expect(rowStatus()).toBe(subscriptionRowStatus());

    // 刷新失败：原因与「上次成功」同时出现在设置页同一行。
    mockBackend({
      webcalFetch: () =>
        new Error(`error sending request for url (${SUBSCRIBE_URL})`),
    });
    fireEvent.click(within(row).getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(rowStatus()).toContain("刷新失败"));
    expect(rowStatus()).toContain("上次成功");
    expect(rowStatus()).toBe(subscriptionRowStatus());
  });

  it("停用本地导入来源后数据仍在，重新显示立即恢复（验收 3，与订阅同一口径）", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(IMPORT_ICS, "team.ics"));
    await waitFor(() => expect(screen.getByText(/新增 2/)).toBeTruthy());

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    const dayCell = () =>
      grid.querySelector('[data-date="2026-09-23"]') as HTMLElement;
    expect(within(dayCell()).getByText("19:00 晚间例会")).toBeTruthy();

    fireEvent.click(within(sidebar()).getByLabelText("team.ics"));
    await waitFor(() => expect(subscriptionRowStatus()).toContain("已停用"));
    expect(within(dayCell()).queryByText(/晚间例会/)).toBeNull();

    // 停用只改显示：事件与来源都留在快照里（启停不删除用户数据）。
    const snapshot = writtenSnapshots().at(-1)!;
    expect(snapshot.events).toHaveLength(2);
    expect(
      (snapshot.sources as Array<Record<string, unknown>>)[0].enabled,
    ).toBe(false);

    // 重新显示：不需要重新导入文件。
    fireEvent.click(within(sidebar()).getByLabelText("team.ics"));
    await waitFor(() =>
      expect(within(dayCell()).getByText("19:00 晚间例会")).toBeTruthy(),
    );
  });

  it("启动读回刷新间隔：选项内的取值直接进设置页，不改写成默认（验收 2）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [WEBCAL_INTERVAL_KEY]: 60 }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    const pane = openSettings();
    const select = within(pane).getByLabelText(
      "WebCal 刷新间隔",
    ) as HTMLSelectElement;
    // 此前只有「坏值回落默认」这一半有集成证据，选项内的取值只有纯函数单测。
    expect(select.value).toBe("60");
    expect(within(pane).getByText(/每小时自动检查订阅/)).toBeTruthy();
  });

  it("改一批偏好后重启：七条逐项恢复（验收 2，「可持久化」走完整一圈）", async () => {
    await renderReadyApp();
    const pane = openSettings();

    // 七条偏好各改一次，全部通过设置页的控件（写）。
    fireEvent.click(within(pane).getByRole("button", { name: "深色" }));
    fireEvent.click(builtinCheckbox(pane, "中国节假日"));
    fireEvent.click(builtinCheckbox(pane, "英超赛程"));
    fireEvent.change(within(pane).getByLabelText("WebCal 刷新间隔"), {
      target: { value: "60" },
    });
    fireEvent.click(within(pane).getByLabelText(/阿森纳/));
    fireEvent.click(within(pane).getByLabelText("日历提醒"));
    fireEvent.change(within(pane).getByLabelText("比赛提醒提前量"), {
      target: { value: "15" },
    });
    fireEvent.click(closeBehaviorButton("退出应用"));

    // 每次落盘都是整份快照：等到最后一份把七条都带上。
    await waitFor(() => {
      const settings = snapshotSettings();
      expect(settings["app.theme"]).toBe("dark");
      expect(settings[BUILTIN_HIDDEN_KEY]).toEqual([
        "cn-holiday",
        "premier-league",
      ]);
      expect(settings[WEBCAL_INTERVAL_KEY]).toBe(60);
      expect(settings[FOLLOWED_TEAMS_KEY]).toEqual(["arsenal"]);
      expect(settings[NOTIFICATIONS_ENABLED_KEY]).toBe(false);
      expect(settings[MATCH_REMINDER_KEY]).toBe(15);
      expect(settings[CLOSE_BEHAVIOR_KEY]).toBe("quit");
    });

    // 重启（读）：把最后写下的快照原样交给下一次启动。
    const snapshot = JSON.stringify(writtenSnapshots().at(-1));
    cleanup();
    mockBackend({ dataStoreRead: snapshot });
    freezeClock();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/本地数据层就绪/)).toBeTruthy(),
    );

    // 主题在装配层就恢复，不必等到打开设置页。
    expect(document.documentElement.dataset.theme).toBe("dark");

    const reopened = openSettings();
    expect(builtinCheckbox(reopened, "中国节假日").checked).toBe(false);
    expect(builtinCheckbox(reopened, "英超赛程").checked).toBe(false);
    expect(
      (within(reopened).getByLabelText("WebCal 刷新间隔") as HTMLSelectElement)
        .value,
    ).toBe("60");
    expect(
      (within(reopened).getByLabelText(/阿森纳/) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(reopened).getByLabelText("日历提醒") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (within(reopened).getByLabelText("比赛提醒提前量") as HTMLSelectElement)
        .value,
    ).toBe("15");
    expect(closeBehaviorButton("退出应用").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("启动读回通知总开关：关闭时显示未选中，到点也不弹（验收 2）", async () => {
    mockBackend({
      dataStoreRead: seededSnapshot({ [NOTIFICATIONS_ENABLED_KEY]: false }),
    });
    freezeClock();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());

    const pane = openSettings();
    expect(
      (within(pane).getByLabelText("日历提醒") as HTMLInputElement).checked,
    ).toBe(false);
    closeSettings();

    // 持久化的开关真的管住调度：导入比赛、推到提醒时刻也不发通知。
    await importMatchIcs();
    await advanceTo(2026, 9, 26, 23, 30);
    expect(sentNotifications()).toEqual([]);
  });

  it("关掉「日历提醒」立即不再弹，重新打开立即恢复（验收 1，不需要重启）", async () => {
    await renderReadyApp();
    await importMatchIcs();

    const pane = openSettings();
    fireEvent.click(within(pane).getByLabelText("日历提醒"));
    await waitFor(() =>
      expect(snapshotSettings()[NOTIFICATIONS_ENABLED_KEY]).toBe(false),
    );
    closeSettings();

    // 到点不弹：关掉的是本次会话的调度，不是“下次启动才生效”。
    await advanceTo(2026, 9, 26, 23, 5);
    expect(sentNotifications()).toEqual([]);

    // 重新打开：待触发的提醒立刻回到计划里（仍在迟到容忍窗口内，NOTIFY-004）。
    const reopened = openSettings();
    fireEvent.click(within(reopened).getByLabelText("日历提醒"));
    await waitFor(() =>
      expect(snapshotSettings()[NOTIFICATIONS_ENABLED_KEY]).toBe(true),
    );
    closeSettings();

    await advanceTo(2026, 9, 26, 23, 10);
    await waitFor(() => expect(sentNotifications()).toHaveLength(1));
    expect(sentNotifications()[0].title).toBe("Arsenal vs Manchester City");
  });

  it("改「比赛提醒」提前量立即按新时刻重排（验收 1，不需要重启）", async () => {
    await renderReadyApp();
    await importMatchIcs();

    // 默认建议是赛前 30 分钟（23:30 的比赛 → 23:00 触发）。
    await advanceTo(2026, 9, 26, 22, 0);
    const pane = openSettings();
    fireEvent.change(within(pane).getByLabelText("比赛提醒提前量"), {
      target: { value: "15" },
    });
    await waitFor(() =>
      expect(snapshotSettings()[MATCH_REMINDER_KEY]).toBe(15),
    );
    closeSettings();

    // 旧计划已经被换掉：23:00 不再弹（否则说明改动要等下一次启动才生效）。
    await advanceTo(2026, 9, 26, 23, 0);
    expect(sentNotifications()).toEqual([]);

    // 新计划立即生效：赛前 15 分钟。
    await advanceTo(2026, 9, 26, 23, 15);
    await waitFor(() => expect(sentNotifications()).toHaveLength(1));
    expect(sentNotifications()[0].body).toContain("赛前 15 分钟");
  });
});

/**
 * SC-019 集成：外部与本地失败都不破坏日历，且失败的说法必须与真实情况一致
 * ——不冒充预览模式、不假装写进了磁盘、不把订阅地址写进日志。
 */
describe("错误降级与可解释状态（SC-019 / app-spec §13–14）", () => {
  it("快照打不开：给出原因与后果，不冒充预览模式，月视图照常可用", async () => {
    freezeClock();
    mockBackend({ dataStoreRead: new Error("磁盘只读（os error 13）") });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/本地数据层不可用（磁盘只读/)).toBeTruthy(),
    );
    // 状态行同时说明“为什么”和“会失去什么”。
    const status = within(sidebar()).getByText(/本地数据层不可用/).textContent;
    expect(status).toContain("磁盘只读（os error 13）");
    expect(status).toContain("日历可浏览");
    expect(status).toContain("导入与订阅不可用");
    expect(status).toContain("设置更改不会保存");
    // 日历继续可用：降级不是不可用。
    expect(screen.getByRole("grid", { name: "2026年9月" })).toBeTruthy();
    // 也没有被打扮成浏览器预览模式。
    expect(within(sidebar()).queryByText(/浏览器预览模式/)).toBeNull();

    // 导入与订阅各自说明这次动作不会发生（不是“发生了但没保存”）。
    chooseImportFile(icsFile(IMPORT_ICS));
    await waitFor(() =>
      expect(
        within(sidebar()).getByText(
          "本地数据层不可用：无法导入（需要可以写入的本地文件）",
        ),
      ).toBeTruthy(),
    );
    fireEvent.change(within(sidebar()).getByLabelText(/订阅 ICS/), {
      target: { value: SUBSCRIBE_URL },
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "添加" }));
    await waitFor(() =>
      expect(
        within(sidebar()).getByText(
          "本地数据层不可用：无法添加订阅（需要可以写入的本地文件）",
        ),
      ).toBeTruthy(),
    );
    // 数据层不可用时不会真的去联网。
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "webcal_fetch"),
    ).toHaveLength(0);

    // 设置页顶部说的是同一份状态（改动不写盘）。
    const pane = openSettings();
    expect(
      within(pane).getByText(
        /本地数据层不可用（磁盘只读（os error 13））：改动不写入本地设置/,
      ),
    ).toBeTruthy();
  });

  it("落盘失败不静默：界面已按新状态显示，状态行说明没写进磁盘，恢复后自动清除", async () => {
    await renderReadyApp();
    mockBackend({ dataStoreWrite: new Error("磁盘已满") });

    const pane = openSettings();
    fireEvent.click(within(pane).getByRole("button", { name: "深色" }));

    await waitFor(() =>
      expect(within(sidebar()).getByText(/未能写入本地文件/)).toBeTruthy(),
    );
    // 两件事同时为真，说法也要同时给出：主题已经生效，但没落盘。
    expect(document.documentElement.dataset.theme).toBe("dark");
    const problem = within(sidebar()).getByText(/未能写入本地文件/).textContent;
    expect(problem).toContain("设置未能写入本地文件：磁盘已满");
    expect(problem).toContain("重启后可能丢失");

    // 写盘恢复后，任何一次成功写入都会清掉这条提示（说的是当前事实）。
    mockBackend();
    fireEvent.click(within(pane).queryByRole("button", { name: "浅色" })!);
    await waitFor(() =>
      expect(within(sidebar()).queryByText(/未能写入本地文件/)).toBeNull(),
    );
  });

  it("落盘失败的文案与日志都脱敏（订阅地址不进状态行）", async () => {
    await renderReadyApp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockBackend({
      webcalFetch: () => webcalOk(SUBSCRIBE_ICS),
      dataStoreWrite: new Error(`写入失败：${SUBSCRIBE_URL}`),
    });

    fireEvent.change(within(sidebar()).getByLabelText(/订阅 ICS/), {
      target: { value: SUBSCRIBE_URL },
    });
    fireEvent.click(within(sidebar()).getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(within(sidebar()).getByText(/未能写入本地文件/)).toBeTruthy(),
    );
    // 落盘失败的原因来自系统，可能带上地址；状态行与日志都只留脱敏形式。
    const problem = within(sidebar()).getByText(/未能写入本地文件/).textContent;
    expect(problem).not.toContain("SECRET-TOKEN");
    expect(problem).toContain("?…");
    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("落盘失败");
    expect(logged).not.toContain("SECRET-TOKEN");
    warn.mockRestore();
  });

  it("快照里的坏记录被隔离：月视图照常，状态行说明少了几条", async () => {
    freezeClock();
    mockBackend({
      dataStoreRead: JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            id: "local-ics:team",
            type: "local-ics",
            name: "team.ics",
            enabled: true,
          },
          { name: "读不出来的来源" },
        ],
        events: [
          // 缺 start：以前会让整个月格展开抛错，日历直接白屏。
          {
            uid: "bad",
            sourceId: "local-ics:team",
            title: "坏事件",
            allDay: false,
          },
          {
            uid: "good",
            sourceId: "local-ics:team",
            title: "好事件",
            start: "2026-09-23T19:00:00",
            allDay: false,
          },
        ],
        enrichments: {},
        settings: {},
      }),
    });

    render(<App />);

    // 好事件照常进月格，坏记录只是不出现。
    await waitFor(() => expect(screen.getByText(/已跳过/)).toBeTruthy());
    const grid = screen.getByRole("grid", { name: "2026年9月" });
    expect(
      within(grid.querySelector('[data-date="2026-09-23"]')!).getByText(
        "19:00 好事件",
      ),
    ).toBeTruthy();
    expect(within(sidebar()).getByText("team.ics")).toBeTruthy();
    // 被隔离的是哪几类记录，状态行要说清楚。
    const status = within(sidebar()).getByText(/已跳过/).textContent;
    expect(status).toContain("1 个无法读取的事件");
    expect(status).toContain("1 个无法读取的来源");
    // 坏记录不会跟着落盘，文件里不会一直留着它们。
    expect(writtenSnapshots().at(-1)!.events).toHaveLength(1);
    expect(writtenSnapshots().at(-1)!.sources).toHaveLength(1);
  });
});

describe("月切换的分片读取（SC-020 / app-spec §15）", () => {
  it("大数据量导入后月格照常显示，整理状态不残留", async () => {
    await renderReadyApp();

    // 真实规模的混合形态（含重复规则与例外），走完整的导入 → 标准化 →
    // 匹配 → 落库 → 读取路径。读取这一段现在由 use-month-occurrences
    // 分片执行，界面在整理期间给出状态行、而不是整段卡住。
    chooseImportFile(icsFile(buildIcsFixture(1_500), "big.ics"));

    await waitFor(() => expect(screen.getByText(/新增 \d+/)).toBeTruthy(), {
      timeout: 10_000,
    });

    const grid = screen.getByRole("grid", { name: "2026年9月" });
    await waitFor(
      () =>
        expect(
          grid.querySelectorAll("[data-date] .cell-event").length,
        ).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
    // 整理完成后状态行消失：界面上的说法与真正发生的事一致。
    expect(screen.queryByText(/正在整理事件/)).toBeNull();
  });

  it("304 刷新不重算月格：事件集合没变就不重新读取", async () => {
    const calls: Array<Record<string, unknown>> = [];
    await renderReadyApp();
    mockBackend({
      webcalFetch: (args) => {
        calls.push(args);
        return calls.length === 1
          ? webcalOk(SUBSCRIBE_ICS, { etag: 'W/"v1"' })
          : WEBCAL_NOT_MODIFIED;
      },
    });
    await subscribeToFeed();

    // 读取事件的代价是逐条克隆（10,000 条约 37 ms），而读取方拿到新数组就会
    // 重算月格。304 什么都没改，因此不该再读一遍（SC-020 的缓存失效）。
    const reads = vi.spyOn(CalendarStore.prototype, "listEnrichedEvents");
    const before = reads.mock.calls.length;

    fireEvent.click(within(sidebar()).getByRole("button", { name: "刷新" }));
    await waitFor(() =>
      expect(within(sidebar()).getByText(/没有变化/)).toBeTruthy(),
    );

    expect(reads.mock.calls.length).toBe(before);
    // 事件仍在界面上（来源行更新了，月格没被清空）。
    expect(
      screen
        .getByRole("grid", { name: "2026年9月" })
        .querySelectorAll("[data-date] .cell-event").length,
    ).toBeGreaterThan(0);
  });

  it("大数据量下提醒仍按计划触发：计划重建分片不改变提醒时间", async () => {
    await renderReadyApp();

    // 1,500 条事件让提醒计划的重建走分片路径（展开 30 天窗口约 154 ms），
    // 再导入一场时间已知的比赛：到点仍然按原时间弹出。
    chooseImportFile(icsFile(buildIcsFixture(1_500), "big.ics"));
    await waitFor(() => expect(screen.getByText(/新增 \d+/)).toBeTruthy(), {
      timeout: 10_000,
    });
    chooseImportFile(icsFile(MATCH_ICS, "matches.ics"));
    await waitFor(() => expect(screen.getByText(/新增 1/)).toBeTruthy(), {
      timeout: 10_000,
    });

    // 计划就绪：设置页能看到下一条提醒（分片重建完成、调度器已重排）。
    const pane = openSettings();
    await waitFor(
      () => expect(within(pane).getByText(/下一条提醒/)).toBeTruthy(),
      { timeout: 10_000 },
    );
    closeSettings();

    // 比赛 2026-09-26 23:30，默认提前 30 分钟。
    await advanceTo(2026, 9, 26, 22, 59);
    expect(sentNotifications().map((entry) => entry.title)).not.toContain(
      "Arsenal vs Manchester City",
    );
    await advanceTo(2026, 9, 26, 23, 0);
    expect(sentNotifications().map((entry) => entry.title)).toContain(
      "Arsenal vs Manchester City",
    );
  });

  it("整理未完成时切月：新月份不会显示上个月的月格数据", async () => {
    await renderReadyApp();
    chooseImportFile(icsFile(buildIcsFixture(1_500), "big.ics"));
    await waitFor(() => expect(screen.getByText(/新增 \d+/)).toBeTruthy(), {
      timeout: 10_000,
    });

    // 9 月的事件落格之后切到 10 月：切换后的月格必须只含 10 月的日期。
    const september = screen.getByRole("grid", { name: "2026年9月" });
    await waitFor(
      () =>
        expect(
          september.querySelectorAll("[data-date] .cell-event").length,
        ).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
    fireEvent.click(
      within(screen.getByRole("main")).getByRole("button", { name: "下一月" }),
    );

    const october = await screen.findByRole("grid", { name: "2026年10月" });
    await waitFor(
      () =>
        expect(
          october.querySelectorAll("[data-date] .cell-event").length,
        ).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
    for (const cell of october.querySelectorAll("[data-date]")) {
      expect(cell.getAttribute("data-date")).toMatch(/^2026-(09|10|11)-/);
    }
    expect(screen.queryByText(/正在整理事件/)).toBeNull();
  });
});
