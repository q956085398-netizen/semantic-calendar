import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  buildMonthGrid,
  parseDateKey,
  shiftDateKey,
  todayKeyFromDate,
  type YearMonth,
} from "./calendar/month-grid";
import { bucketEventsByDateKey } from "./calendar/event-buckets";
import { expandEventOccurrences } from "./normalize/occurrences";
import { MiniMonth } from "./calendar/MiniMonth";
import { MonthView } from "./calendar/MonthView";
import { openDesktopCalendarStore } from "./data/desktop-store";
import type { CalendarSource, EnrichedEvent } from "./data/model";
import {
  importLocalIcs,
  type LocalIcsImportOutcome,
} from "./data/import/import-local-ics";
import { createTauriHttpIO } from "./data/net/tauri-http-io";
import {
  addWebcalSubscription,
  refreshWebcalSource,
  type WebcalRefreshOutcome,
} from "./data/webcal/webcal-refresh";
import {
  createWebcalScheduler,
  type WebcalRefreshScheduler,
} from "./data/webcal/refresh-scheduler";
import {
  describeRedactedError,
  normalizeWebcalUrl,
} from "./data/webcal/webcal-url";
import type { CalendarStore } from "./data/store/calendar-store";
import type { StoreRecoveryReason } from "./data/store/calendar-store";
import { reEnrichStore } from "./semantic/enrich";
import { createAppSemanticStack } from "./semantic/app-registry";
import { lunarLabelsOf } from "./semantic/app-lunar";
import {
  FOLLOWED_TEAMS_SETTING_KEY,
  listFollowableTeams,
  readFollowedTeamIds,
  toggleFollowedTeam,
} from "./semantic/app-followed-teams";
import { AppShell } from "./layout/AppShell";
import { InspectorPanel } from "./layout/InspectorPanel";
import { Sidebar } from "./layout/Sidebar";
import { formatDateTime } from "./format/time";
import {
  CLOSE_BEHAVIOR_SETTING_KEY,
  DEFAULT_CLOSE_BEHAVIOR,
  normalizeCloseBehavior,
  type CloseBehavior,
} from "./shell/close-behavior";
import { createTauriShellBridge } from "./shell/shell-bridge";
import { isTauriIpcUnavailable } from "./ipc/tauri-ipc";
import {
  THEME_SETTING_KEY,
  applyTheme,
  normalizeTheme,
  toggleTheme,
  type Theme,
} from "./theme/theme";

const LAST_OPENED_SETTING = "app.lastOpenedAt";

/**
 * 语义栈（SC-009）：静态注册的 Matcher + Metadata Resolver。
 * 每次启动用当前注册表整体重建增强结果（SEM-004），Matcher 升级后
 * 语义随之更新，无需重新导入源数据。
 */
const semanticStack = createAppSemanticStack();

/** 订阅网络访问（SC-007）：桌面壳由 Rust 侧抓取，webview 不直接联网。 */
const httpIO = createTauriHttpIO();

/** 桌面壳（SC-002）：关闭行为由 Rust 侧执行，前端只推送设置值。 */
const shellBridge = createTauriShellBridge();

/**
 * 可关注球队（SC-016）：静态元数据，启动装配一次即可。
 * 侧栏只渲染这份展示载荷，不做任何球队名匹配。
 */
const followableTeams = listFollowableTeams();

const REASON_LABELS: Record<StoreRecoveryReason, string> = {
  "corrupt-json": "文件损坏",
  "invalid-shape": "结构异常",
  "future-version": "来自更新版本的应用",
};

const PREVIEW_MODE_HINT = "浏览器预览模式：订阅需要桌面环境";

/** 托盘不可用时的降级说明：桌面壳会把“隐藏到托盘”变成直接退出。 */
const TRAY_UNAVAILABLE_HINT = "系统托盘不可用：关闭窗口将直接退出应用";

/** 导入结果 → 用户可读状态；只报告数量、位置与结构原因，不外泄事件正文（app-spec §14）。 */
function formatImportStatus(outcome: LocalIcsImportOutcome): string {
  const fileIssue = outcome.issues.find(
    (issue) => issue.eventIndex === undefined,
  );
  if (!outcome.source && fileIssue) {
    return `导入失败：${fileIssue.message}`;
  }
  const name = outcome.source?.name ?? "";
  const parts = [`新增 ${outcome.inserted}`];
  if (outcome.updated > 0) {
    parts.push(`更新 ${outcome.updated}`);
  }
  if (outcome.skipped > 0) {
    const first = outcome.issues.find(
      (issue) => issue.eventIndex !== undefined,
    );
    parts.push(
      `跳过 ${outcome.skipped} 个无法解析的事件` +
        (first ? `（第 ${first.eventIndex} 项：${first.message}）` : ""),
    );
  }
  return `已导入「${name}」：${parts.join("、")}`;
}

/** 刷新结果的数量与原因片段；地址细节已在服务层脱敏（§14）。 */
function outcomeDetail(outcome: WebcalRefreshOutcome): string {
  switch (outcome.status) {
    case "updated": {
      const parts = [`新增 ${outcome.inserted}`];
      if (outcome.updated > 0) {
        parts.push(`更新 ${outcome.updated}`);
      }
      if (outcome.removed > 0) {
        parts.push(`移除 ${outcome.removed}`);
      }
      if (outcome.skipped > 0) {
        parts.push(`跳过 ${outcome.skipped} 个无法解析的事件`);
      }
      return `：${parts.join("、")}`;
    }
    case "not-modified":
      return "：没有变化，继续使用本地缓存";
    case "failed":
      return `：${outcome.error ?? "未知原因"}`;
  }
}

function formatRefreshStatus(
  name: string,
  outcome: WebcalRefreshOutcome,
): string {
  return outcome.status === "failed"
    ? `「${name}」刷新失败${outcomeDetail(outcome)}`
    : `已刷新「${name}」${outcomeDetail(outcome)}`;
}

/** 异常 → 可展示文案：按该订阅的地址脱敏（§14）。 */
function describeError(error: unknown, url: string): string {
  const normalized = normalizeWebcalUrl(url);
  return describeRedactedError(
    error,
    normalized.ok ? normalized.url : url.trim(),
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [storeStatus, setStoreStatus] = useState("正在初始化本地数据层…");
  const storeRef = useRef<CalendarStore | null>(null);
  const [today] = useState(() => new Date());

  // 窗口行为（SC-002）：关闭窗口是隐藏到托盘还是退出。权威来源是快照设置，
  // 这里只是 UI 镜像；真正执行的是桌面壳。
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>(
    DEFAULT_CLOSE_BEHAVIOR,
  );
  const [closeBehaviorStatus, setCloseBehaviorStatus] = useState<
    string | undefined
  >();

  // 数据源与事件（SC-006）：从本地数据层读出，导入后刷新。
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [importStatus, setImportStatus] = useState<string | undefined>();
  const [importBusy, setImportBusy] = useState(false);

  // 关注球队（SC-016 / SPORT-006）：设置里的稳定球队 id 列表。
  const [followedTeamIds, setFollowedTeamIds] = useState<readonly string[]>([]);

  // 订阅状态（SC-007）：添加 / 刷新的进行中标记与最近一次动作结果。
  const [subscriptionStatus, setSubscriptionStatus] = useState<
    string | undefined
  >();
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  /** 正在刷新的来源（含后台刷新）：行状态与按钮都据此显示。 */
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<
    readonly string[]
  >([]);
  const schedulerRef = useRef<WebcalRefreshScheduler | null>(null);

  // 视图月份与选中日期（SC-005 / CAL-002）：today 只作为初始锚点注入，
  // 网格计算保持纯函数（month-grid），不在此读取真实时钟。
  const todayKey = useMemo(() => todayKeyFromDate(today), [today]);
  const [view, setView] = useState<YearMonth>(() => ({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  }));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);

  const grid = useMemo(
    () => buildMonthGrid({ ...view, today: todayKey }),
    [view, todayKey],
  );
  /**
   * 可见 occurrence（SC-008）：按当前网格范围展开重复规则并完成时区
   * 规范化，再进入日期分桶。原始事件列表不由此改动。
   */
  const visibleOccurrences = useMemo(() => {
    const first = grid.weeks[0][0].dateKey;
    const lastWeek = grid.weeks[grid.weeks.length - 1];
    const last = lastWeek[lastWeek.length - 1].dateKey;
    return expandEventOccurrences(events, { from: first, to: last });
  }, [events, grid]);
  const eventsByDate = useMemo(
    () => bucketEventsByDateKey(visibleOccurrences),
    [visibleOccurrences],
  );
  const selectedEvents = eventsByDate.get(selectedDateKey) ?? [];

  /**
   * 农历简写（SC-010 / CN-001）：随网格一起重算，范围外的日期不进 Map。
   * 与事件一样按日期键注入月视图，组件不做换算（业务规则不进 UI）。
   */
  const lunarByDate = useMemo(() => lunarLabelsOf(grid.weeks.flat()), [grid]);

  /**
   * 从本地数据层重建 UI 状态；只显示启用来源的事件（SRC-003）。
   * useCallback：供启动 effect 与后台调度长期持有，身份必须稳定。
   */
  const refreshFromStore = useCallback((store: CalendarStore) => {
    const nextSources = store.listSources();
    const enabled = new Set(
      nextSources.filter((source) => source.enabled).map((source) => source.id),
    );
    setSources(nextSources);
    setEvents(
      store.listEnrichedEvents().filter((event) => enabled.has(event.sourceId)),
    );
  }, []);

  /** 标记 / 取消“刷新中”：手动与后台刷新共用，避免同一来源重复入列。 */
  const markRefreshing = useCallback((sourceId: string, busy: boolean) => {
    setRefreshingSourceIds((current) =>
      busy
        ? current.includes(sourceId)
          ? current
          : [...current, sourceId]
        : current.filter((id) => id !== sourceId),
    );
  }, []);

  /**
   * 把关闭行为推给桌面壳（启动与切换共用）。
   *
   * 两种“说的和做的不一致”都要让用户看到（§13）：推送失败，或桌面壳
   * 报告托盘不可用——此时“隐藏到托盘”已被降级成退出。状态文案只陈述
   * 桌面壳报告的事实，不从返回值差异反推原因。浏览器预览模式没有桌面壳，
   * 静默跳过：设置仍可切换，只是不生效也不持久化，与主题切换口径一致。
   */
  const pushCloseBehavior = useCallback(async (behavior: CloseBehavior) => {
    try {
      const status = await shellBridge.setCloseBehavior(behavior);
      setCloseBehaviorStatus(
        status.trayAvailable ? undefined : TRAY_UNAVAILABLE_HINT,
      );
    } catch (error) {
      if (isTauriIpcUnavailable(error)) {
        return;
      }
      setCloseBehaviorStatus(
        `关闭行为未能应用：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  /**
   * 写入一个用户设置并立即落盘；没有数据层（预览模式）时只改内存状态。
   * 主题、关注球队与关闭行为共用这一条路径。
   */
  const persistSetting = useCallback(async (key: string, value: unknown) => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    store.setSetting(key, value);
    await store.save();
  }, []);

  /**
   * 刷新一个订阅并落盘（手动刷新与后台调度共用同一条路径）。
   * 只有内容真正变化时才重建语义增强，304 与失败不动增强分区。
   */
  const refreshSubscription = useCallback(
    async (
      store: CalendarStore,
      sourceId: string,
    ): Promise<WebcalRefreshOutcome> => {
      markRefreshing(sourceId, true);
      try {
        const outcome = await refreshWebcalSource(store, sourceId, httpIO);
        if (outcome.status === "updated") {
          reEnrichStore(store, semanticStack);
        }
        await store.save();
        refreshFromStore(store);
        return outcome;
      } finally {
        markRefreshing(sourceId, false);
      }
    },
    [markRefreshing, refreshFromStore],
  );

  useEffect(() => {
    let cancelled = false;

    async function initStore() {
      const opened = await openDesktopCalendarStore();
      if (cancelled) return;

      if (!opened) {
        setStoreStatus("浏览器预览模式：本地数据层仅桌面壳可用");
        return;
      }

      const { store, recovery } = opened;
      storeRef.current = store;
      // 语义增强（SC-009）：用当前 Matcher 注册表重建后再进入 UI。
      reEnrichStore(store, semanticStack);
      refreshFromStore(store);

      // 低频后台刷新（SC-007 / §12）：只在到达刷新时间时唤醒一次。
      // 调度器只读来源状态，所有写入仍由 refreshSubscription 负责；
      // 数据层恢复（隔离后从空快照启动）时同样装配，本次会话新加的订阅
      // 也能进入调度。
      const scheduler = createWebcalScheduler({
        listSources: () => store.listSources(),
        refresh: async (sourceId) => {
          await refreshSubscription(store, sourceId);
        },
        onError: (error, sourceId) => {
          // 错误正文可能来自网络栈并带上订阅地址，这里只留来源标识（§14）。
          console.warn(
            "[webcal] 后台刷新失败",
            sourceId,
            error instanceof Error ? error.name : "unknown",
          );
        },
      });
      schedulerRef.current = scheduler;
      scheduler.start();

      const savedTheme = normalizeTheme(store.getSetting(THEME_SETTING_KEY));
      applyTheme(savedTheme);
      setTheme(savedTheme);

      // 窗口行为（SC-002）：快照设置是权威来源，启动时同步给桌面壳，
      // 否则“上次选的退出”会在下次启动后变回隐藏到托盘。
      const savedCloseBehavior = normalizeCloseBehavior(
        store.getSetting(CLOSE_BEHAVIOR_SETTING_KEY),
      );
      setCloseBehavior(savedCloseBehavior);
      await pushCloseBehavior(savedCloseBehavior);
      if (cancelled) return;

      // 关注球队（SC-016）：坏值在读取边界丢弃，不猜成某支球队。
      setFollowedTeamIds(
        readFollowedTeamIds(store.getSetting(FOLLOWED_TEAMS_SETTING_KEY)),
      );

      const previous = store.getSetting<string | undefined>(
        LAST_OPENED_SETTING,
      );
      store.setSetting(LAST_OPENED_SETTING, new Date().toISOString());
      await store.save();
      if (cancelled) return;

      if (recovery) {
        setStoreStatus(
          `本地数据层已重置（${REASON_LABELS[recovery.reason]}），原文件已备份`,
        );
        return;
      }
      const version = `schema v${store.schemaVersion}`;
      setStoreStatus(
        previous
          ? `本地数据层就绪（${version}），上次启动 ${formatDateTime(previous)}`
          : `本地数据层就绪（${version}），首次启动`,
      );
    }

    initStore().catch(() => {
      if (!cancelled) {
        setStoreStatus("本地数据层初始化失败");
      }
    });

    return () => {
      cancelled = true;
      schedulerRef.current?.stop();
      schedulerRef.current = null;
    };
    // 三个回调身份稳定（useCallback），该 effect 实际只在挂载时执行一次。
  }, [
    markRefreshing,
    pushCloseBehavior,
    refreshFromStore,
    refreshSubscription,
  ]);

  /**
   * 添加订阅（SC-007 / SRC-002）：地址归一化 → 建源 → 立即抓取一次。
   * 返回是否创建成功，供侧栏决定是否清空输入。
   */
  async function handleAddSubscription(url: string): Promise<boolean> {
    const store = storeRef.current;
    if (!store) {
      setSubscriptionStatus(PREVIEW_MODE_HINT);
      return false;
    }
    setSubscribeBusy(true);
    try {
      const outcome = await addWebcalSubscription(store, { url }, httpIO);
      if (outcome.error !== undefined) {
        setSubscriptionStatus(`添加订阅失败：${outcome.error}`);
        return false;
      }
      if (outcome.refresh?.status === "updated") {
        reEnrichStore(store, semanticStack);
      }
      await store.save();
      refreshFromStore(store);
      schedulerRef.current?.reschedule();
      const name = outcome.source?.name ?? "订阅";
      const detail =
        outcome.refresh === undefined ? "" : outcomeDetail(outcome.refresh);
      setSubscriptionStatus(
        outcome.refresh?.status === "failed"
          ? `已订阅「${name}」，但首次抓取失败${detail}`
          : `已订阅「${name}」${detail}`,
      );
      return true;
    } catch (error) {
      setSubscriptionStatus(`添加订阅失败：${describeError(error, url)}`);
      return false;
    } finally {
      setSubscribeBusy(false);
    }
  }

  /** 手动刷新订阅：不阻塞界面，进行中禁用该行按钮。 */
  async function handleRefreshSubscription(sourceId: string) {
    const store = storeRef.current;
    if (!store) {
      setSubscriptionStatus(PREVIEW_MODE_HINT);
      return;
    }
    const source = store.getSource(sourceId);
    const name = source?.name ?? "订阅";
    try {
      const outcome = await refreshSubscription(store, sourceId);
      schedulerRef.current?.reschedule();
      setSubscriptionStatus(formatRefreshStatus(name, outcome));
    } catch (error) {
      setSubscriptionStatus(
        `刷新失败：${describeError(error, source?.webcal?.url ?? "")}`,
      );
    }
  }

  /** 启用 / 停用来源（SRC-003）：停用后事件立即从月视图消失，数据保留。 */
  async function handleToggleSource(sourceId: string, enabled: boolean) {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    if (!store.setSourceEnabled(sourceId, enabled)) {
      return;
    }
    await store.save();
    refreshFromStore(store);
    schedulerRef.current?.reschedule();
    setSubscriptionStatus(enabled ? "已启用该订阅" : "已停用该订阅");
  }

  /** 删除订阅：连同其事件与增强结果一起删除（级联）。 */
  async function handleRemoveSubscription(sourceId: string) {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    const name = store.getSource(sourceId)?.name ?? "订阅";
    store.removeSource(sourceId);
    await store.save();
    refreshFromStore(store);
    schedulerRef.current?.reschedule();
    setSubscriptionStatus(`已删除「${name}」及其事件`);
  }

  /** 月份步进（主视图与小月历共用），纯计算跨年进位。 */
  function stepMonth(delta: number) {
    setView((current) => addMonths(current, delta));
  }

  /** 回到今天：视图月份与选中日期同时归位（CAL-002）。 */
  function goToToday() {
    setView({ year: today.getFullYear(), month: today.getMonth() + 1 });
    setSelectedDateKey(todayKey);
  }

  /**
   * 选择日期：选中跨出当前视图月时自动切换视图，
   * 使选中格永远可见（跨月日期点击 / 方向键导航共用）。
   */
  function selectDate(dateKey: string) {
    setSelectedDateKey(dateKey);
    const { year, month } = parseDateKey(dateKey);
    setView((current) =>
      current.year === year && current.month === month
        ? current
        : { year, month },
    );
  }

  /** 键盘导航：从当前选中日期按天移动。 */
  function stepSelection(days: number) {
    selectDate(shiftDateKey(selectedDateKey, days));
  }

  async function handleToggleTheme() {
    const next = toggleTheme(theme);
    setTheme(next);
    applyTheme(next);
    await persistSetting(THEME_SETTING_KEY, next);
  }

  /**
   * 关注 / 取消关注（SC-016 / SPORT-006）：状态立即生效并落盘，
   * 重启后由启动读取恢复。浏览器预览模式与主题切换一致——可切换但不持久化。
   */
  async function handleToggleFollowedTeam(teamId: string, followed: boolean) {
    const next = toggleFollowedTeam(followedTeamIds, teamId, followed);
    setFollowedTeamIds(next);
    await persistSetting(FOLLOWED_TEAMS_SETTING_KEY, next);
  }

  /**
   * 切换关闭行为（SC-002）：状态立即生效并落盘，再推给桌面壳。
   * 与主题、关注球队一致——预览模式下可切换但不持久化。
   */
  async function handleChangeCloseBehavior(next: CloseBehavior) {
    setCloseBehavior(next);
    await persistSetting(CLOSE_BEHAVIOR_SETTING_KEY, next);
    await pushCloseBehavior(next);
  }

  /**
   * 导入本地 ICS（SC-006 / SRC-001）：文件选择 → 解析 → 落库 → 匹配 → 刷新。
   * 解析错误按事件隔离后聚合反馈（ICS-005），异常也不中断月视图。
   */
  async function handleImportIcs(file: File) {
    const store = storeRef.current;
    if (!store) {
      setImportStatus("浏览器预览模式：导入需要桌面环境");
      return;
    }
    setImportBusy(true);
    try {
      const contents = await file.text();
      const outcome = await importLocalIcs(store, {
        fileName: file.name,
        contents,
      });
      reEnrichStore(store, semanticStack);
      await store.save();
      refreshFromStore(store);
      setImportStatus(formatImportStatus(outcome));
    } catch (error) {
      setImportStatus(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <AppShell
      sidebar={
        <Sidebar
          theme={theme}
          onToggleTheme={handleToggleTheme}
          storeStatus={storeStatus}
          miniCalendar={
            <MiniMonth
              grid={grid}
              selectedDateKey={selectedDateKey}
              onSelectDate={selectDate}
              onStepMonth={stepMonth}
            />
          }
          sources={sources}
          onImportIcs={handleImportIcs}
          importBusy={importBusy}
          importStatus={importStatus}
          onAddSubscription={handleAddSubscription}
          onRefreshSubscription={handleRefreshSubscription}
          onToggleSource={handleToggleSource}
          onRemoveSubscription={handleRemoveSubscription}
          subscribeBusy={subscribeBusy}
          refreshingSourceIds={refreshingSourceIds}
          subscriptionStatus={subscriptionStatus}
          followableTeams={followableTeams}
          followedTeamIds={followedTeamIds}
          onToggleFollowedTeam={handleToggleFollowedTeam}
          closeBehavior={closeBehavior}
          onChangeCloseBehavior={handleChangeCloseBehavior}
          closeBehaviorStatus={closeBehaviorStatus}
        />
      }
      inspector={
        <InspectorPanel
          dateKey={selectedDateKey}
          events={selectedEvents}
          lunar={lunarByDate.get(selectedDateKey)}
          followedTeamIds={followedTeamIds}
        />
      }
    >
      <MonthView
        grid={grid}
        selectedDateKey={selectedDateKey}
        onSelectDate={selectDate}
        onStepMonth={stepMonth}
        onGoToToday={goToToday}
        onStepSelection={stepSelection}
        eventsByDate={eventsByDate}
        lunarByDate={lunarByDate}
      />
    </AppShell>
  );
}
