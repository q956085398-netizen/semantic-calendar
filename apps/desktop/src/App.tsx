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
import { gateEventsForBuiltinSources } from "./semantic/app-builtin-sources";
import { lunarLabelsOf } from "./semantic/app-lunar";
import {
  chinaDayLabelsOf,
  type ChinaDayLabel,
} from "./semantic/app-china-days";
import {
  chinaSemanticLabelsOf,
  type ChinaDaySemanticLabel,
} from "./semantic/app-china-festivals";
import { semanticTypeDefaults } from "./semantic/metadata-resolver";
import { reminderLabel } from "./format/reminder";
import {
  BUILTIN_SOURCES_SETTING_KEY,
  isBuiltinSourceEnabled,
  readHiddenBuiltinSourceIds,
  toggleBuiltinSource,
  type BuiltinSourceId,
} from "./settings/builtin-sources";
import {
  DEFAULT_WEBCAL_INTERVAL_MINUTES,
  WEBCAL_INTERVAL_SETTING_KEY,
  normalizeWebcalIntervalMinutes,
  webcalIntervalMs,
} from "./settings/webcal-interval";
import {
  FOLLOWED_TEAMS_SETTING_KEY,
  listFollowableTeams,
  readFollowedTeamIds,
  toggleFollowedTeam,
} from "./semantic/app-followed-teams";
import {
  FIRED_REMINDERS_SETTING_KEY,
  handledReminderIds,
  markReminderHandled,
  pruneHandledReminders,
  readHandledReminders,
  type HandledReminder,
  type ReminderOutcome,
} from "./notifications/fired-reminders";
import {
  describeNotificationFailure,
  createTauriNotificationBridge,
  isPermissionDeniedFailure,
  type NotificationPermissionState,
} from "./notifications/notification-bridge";
import {
  MATCH_REMINDER_SETTING_KEY,
  NOTIFICATIONS_ENABLED_SETTING_KEY,
  DEFAULT_NOTIFICATIONS_ENABLED,
  normalizeMatchReminderSetting,
  normalizeNotificationsEnabled,
  type MatchReminderSetting,
} from "./notifications/notification-settings";
import {
  REMINDER_HORIZON_DAYS,
  planReminders,
  type PlannedReminder,
} from "./notifications/reminder-plan";
import {
  createNotificationScheduler,
  type NotificationScheduler,
} from "./notifications/notification-scheduler";
import {
  canRequestNotificationPermission,
  describeNotificationStatus,
} from "./notifications/notification-status";
import { AppShell } from "./layout/AppShell";
import { InspectorPanel } from "./layout/InspectorPanel";
import { SettingsView } from "./layout/SettingsView";
import { Sidebar } from "./layout/Sidebar";
import {
  PREVIEW_IMPORT_HINT,
  PREVIEW_SUBSCRIBE_HINT,
} from "./layout/preview-mode";
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
 * 本地通知（SC-017 / NOTIFY-001）：发送与权限状态都在 Rust 侧，
 * 这里只是端口；调度（什么时候发）在前端，见 notifications/。
 */
const notificationBridge = createTauriNotificationBridge();

/**
 * 比赛提醒默认建议的文案（NOTIFY-003）：来自 Metadata Resolver 的类型级
 * 默认值，界面因此不必再写一份“赛前 30 分钟”——默认值只有一处来源。
 */
const MATCH_REMINDER_DEFAULT = semanticTypeDefaults("sport.fixture")?.reminder;
const MATCH_REMINDER_DEFAULT_LABEL =
  MATCH_REMINDER_DEFAULT === undefined
    ? undefined
    : reminderLabel(MATCH_REMINDER_DEFAULT);

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

/** 托盘不可用时的降级说明：桌面壳会把“隐藏到托盘”变成直接退出。 */
const TRAY_UNAVAILABLE_HINT = "系统托盘不可用：关闭窗口将直接退出应用";

/**
 * 关闭内置来源时的空载荷（SC-018）：与真实载荷同形，UI 不必判空——
 * 月格与详情栏拿到的永远是一份 Map，只是里面没有条目。
 */
const EMPTY_CHINA_DAYS = new Map<string, ChinaDayLabel>();
const EMPTY_CHINA_SEMANTICS = new Map<string, ChinaDaySemanticLabel>();

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

/** IPC 失败 → 可展示文案；桌面壳不可用以外的失败都要让用户看到（§13）。 */
function describeIpcError(prefix: string, error: unknown): string {
  return `${prefix}：${error instanceof Error ? error.message : String(error)}`;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [storeStatus, setStoreStatus] = useState("正在初始化本地数据层…");
  const storeRef = useRef<CalendarStore | null>(null);
  const [today] = useState(() => new Date());
  /** 没有桌面壳（浏览器预览）：设置可改但写不进快照，提示必须说清楚。 */
  const [previewMode, setPreviewMode] = useState(false);
  /** 设置页是否打开（SC-018）：纯 UI 状态，不持久化——月历是主界面（P-05）。 */
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // 内置来源显示开关（SC-018）：存“被隐藏的 id”，缺省全开。
  const [hiddenBuiltinSourceIds, setHiddenBuiltinSourceIds] = useState<
    readonly BuiltinSourceId[]
  >([]);
  /** WebCal 常规刷新间隔（SC-018 / §12）：UI 状态 + 调度器读取的 ref。 */
  const [webcalIntervalMinutes, setWebcalIntervalMinutes] = useState(
    DEFAULT_WEBCAL_INTERVAL_MINUTES,
  );
  const webcalIntervalRef = useRef(DEFAULT_WEBCAL_INTERVAL_MINUTES);

  // 关注球队（SC-016 / SPORT-006）：设置里的稳定球队 id 列表。
  const [followedTeamIds, setFollowedTeamIds] = useState<readonly string[]>([]);

  // 通知（SC-017 / NOTIFY-001–003）：设置 + 权限状态 + 最近一次失败说明。
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    DEFAULT_NOTIFICATIONS_ENABLED,
  );
  const [matchReminder, setMatchReminder] =
    useState<MatchReminderSetting>(undefined);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermissionState | "unknown"
  >("unknown");
  /** 发送失败 / 权限请求失败的用户可读说明（§13）。 */
  const [notificationProblem, setNotificationProblem] = useState<
    string | undefined
  >();
  /** 已处理提醒日志（NOTIFY-004）：内存副本 + 落盘在快照 settings。 */
  const handledRef = useRef<readonly HandledReminder[]>([]);
  /** 当前计划与“下一条提醒”，供侧栏解释调度状态（§12）。 */
  const [reminderSummary, setReminderSummary] = useState<{
    pending: number;
    next: PlannedReminder | null;
  }>({ pending: 0, next: null });
  const reminderSchedulerRef = useRef<NotificationScheduler | null>(null);

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
   * 可见事件（SC-018）：再经内置来源开关过滤——「我的日历」关掉就没有用户
   * 事件进入展示，「英超赛程」关掉则比赛回到普通事件（semantic/app-builtin-sources）。
   * 三个消费者共用这一份：月格分桶、详情栏与提醒计划，因此界面上的说法与
   * 真正会发生的事不会矛盾。
   */
  const visibleEvents = useMemo(
    () => gateEventsForBuiltinSources(events, hiddenBuiltinSourceIds),
    [events, hiddenBuiltinSourceIds],
  );

  /**
   * 可见 occurrence（SC-008）：按当前网格范围展开重复规则并完成时区
   * 规范化，再进入日期分桶。原始事件列表不由此改动。
   */
  const visibleOccurrences = useMemo(() => {
    const first = grid.weeks[0][0].dateKey;
    const lastWeek = grid.weeks[grid.weeks.length - 1];
    const last = lastWeek[lastWeek.length - 1].dateKey;
    return expandEventOccurrences(visibleEvents, { from: first, to: last });
  }, [visibleEvents, grid]);
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
   * 休假 / 补班载荷（SC-011 / CN-002–004）：与农历同一条路径，随网格重算；
   * 未登记安排的日期不进 Map。月格据此识别连休区段（相邻格共享区段 id），
   * 详情栏消费选中日期的文字层；连续背景与大字视觉由 SC-013 完成。
   */
  const chinaDayByDate = useMemo(
    () => chinaDayLabelsOf(grid.weeks.flat()),
    [grid],
  );

  /**
   * 传统节日 / 节气载荷（SC-012 / CN-005–006）：同样随网格重算，
   * 普通日期不进 Map。月格用节日名与节气角标，详情栏用名称、英文名、
   * 判定依据与释义；专属背景引用随载荷一起给出，由 SC-013 渲染。
   */
  const chinaSemanticByDate = useMemo(
    () => chinaSemanticLabelsOf(grid.weeks.flat()),
    [grid],
  );

  /**
   * 内置来源开关的直接效果（SC-018）：关闭的来源取空载荷，月格与详情栏不必
   * 知道开关存在。原始事件与日级数据仍按网格照常算出（不写回存储），
   * 重新打开立即恢复显示。
   */
  const visibleChinaDayByDate = isBuiltinSourceEnabled(
    hiddenBuiltinSourceIds,
    "cn-holiday",
  )
    ? chinaDayByDate
    : EMPTY_CHINA_DAYS;
  const visibleChinaSemanticByDate = isBuiltinSourceEnabled(
    hiddenBuiltinSourceIds,
    "solar-terms",
  )
    ? chinaSemanticByDate
    : EMPTY_CHINA_SEMANTICS;

  /**
   * 提醒计划（SC-017 / NOTIFY-002–004）：与月格同源的事件集合（含 SC-018
   * 的内置来源开关结果——“英超赛程”关掉后比赛不再按比赛提醒），窗口是
   * “当前日期起 30 天”。计划只在调度需要时（启动、数据变化、跨天、到点）
   * 才算一次，不随渲染重算；窗口每次都读实时时钟，因此常驻数天的会话不会
   * 一直用启动那天的窗口。已处理的提醒（fired 日志）在这里就被排除，
   * 刷新 / 重启后不会重复弹同一条。
   */
  const reminderInputRef = useRef({
    events: visibleEvents,
    notificationsEnabled,
    matchReminder,
  });
  const buildReminderPlan = useCallback(() => {
    const input = reminderInputRef.current;
    const from = todayKeyFromDate(new Date());
    const occurrences = expandEventOccurrences(input.events, {
      from,
      to: shiftDateKey(from, REMINDER_HORIZON_DAYS),
    });
    return planReminders({
      events: occurrences,
      notificationsEnabled: input.notificationsEnabled,
      matchReminder: input.matchReminder,
      nowMs: Date.now(),
      handledIds: handledReminderIds(handledRef.current),
      horizonDays: REMINDER_HORIZON_DAYS,
    });
  }, []);

  /** 事件或设置变化 → 让调度器按最新输入重排（启动时的首次排程同此路径）。 */
  useEffect(() => {
    reminderInputRef.current = {
      events: visibleEvents,
      notificationsEnabled,
      matchReminder,
    };
    reminderSchedulerRef.current?.reschedule();
  }, [visibleEvents, notificationsEnabled, matchReminder]);

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
      setCloseBehaviorStatus(describeIpcError("关闭行为未能应用", error));
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

  /**
   * 读取系统通知权限（启动一次，不轮询）；桌面端没有授权对话框，
   * 权限恒为已允许，因此它主要服务于移动端与“上一次被拒绝”的情形。
   */
  const refreshNotificationPermission = useCallback(async () => {
    try {
      setNotificationPermission(await notificationBridge.status());
    } catch (error) {
      if (isTauriIpcUnavailable(error)) {
        // 没有桌面壳（浏览器预览）：通知不可用，但日历继续可用（§13）。
        setNotificationPermission("unsupported");
        return;
      }
      setNotificationPermission("unknown");
      setNotificationProblem(describeIpcError("读取系统通知状态失败", error));
    }
  }, []);

  /** 向系统请求通知权限（用户开启通知时，或点“请求系统授权”）。 */
  const requestNotificationPermission = useCallback(async () => {
    try {
      setNotificationPermission(await notificationBridge.requestPermission());
    } catch (error) {
      if (isTauriIpcUnavailable(error)) {
        setNotificationPermission("unsupported");
        return;
      }
      setNotificationProblem(describeIpcError("请求系统通知权限失败", error));
    }
  }, []);

  /**
   * 记一条提醒为已处理（NOTIFY-004）：内存 + 快照一起更新。
   * 落盘失败只影响下次启动的去重，因此不阻塞、也不向用户报错。
   */
  const markReminderProcessed = useCallback(
    (reminder: PlannedReminder, outcome: ReminderOutcome) => {
      const nextLog = markReminderHandled(
        handledRef.current,
        { id: reminder.id, at: new Date().toISOString(), outcome },
        Date.now(),
      );
      handledRef.current = nextLog;
      const store = storeRef.current;
      if (store) {
        store.setSetting(FIRED_REMINDERS_SETTING_KEY, nextLog);
        store.save().catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function initStore() {
      const opened = await openDesktopCalendarStore();
      if (cancelled) return;

      if (!opened) {
        setPreviewMode(true);
        setStoreStatus("浏览器预览模式：本地数据层仅桌面壳可用");
        // 没有桌面壳就没有系统通知：状态直接说明，而不是停在“正在读取”（§13）。
        setNotificationPermission("unsupported");
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
      // 也能进入调度。刷新间隔是用户设置（SC-018），调度器按 ref 读取，
      // 因此改设置只需要 reschedule()。
      const savedWebcalInterval = normalizeWebcalIntervalMinutes(
        store.getSetting(WEBCAL_INTERVAL_SETTING_KEY),
      );
      setWebcalIntervalMinutes(savedWebcalInterval);
      webcalIntervalRef.current = savedWebcalInterval;

      const scheduler = createWebcalScheduler({
        listSources: () => store.listSources(),
        refresh: async (sourceId) => {
          await refreshSubscription(store, sourceId);
        },
        intervalMs: () => webcalIntervalMs(webcalIntervalRef.current),
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

      // 内置来源显示开关（SC-018）：只记被隐藏的 id，坏值丢弃即“显示”。
      setHiddenBuiltinSourceIds(
        readHiddenBuiltinSourceIds(
          store.getSetting(BUILTIN_SOURCES_SETTING_KEY),
        ),
      );

      // 通知（SC-017）：设置与去重日志都从快照恢复，坏值回落到默认。
      setNotificationsEnabled(
        normalizeNotificationsEnabled(
          store.getSetting(NOTIFICATIONS_ENABLED_SETTING_KEY),
        ),
      );
      setMatchReminder(
        normalizeMatchReminderSetting(
          store.getSetting(MATCH_REMINDER_SETTING_KEY),
        ),
      );
      // 去重日志顺带裁剪过期条目：日志是状态而不是历史，体量必须可控。
      handledRef.current = pruneHandledReminders(
        readHandledReminders(store.getSetting(FIRED_REMINDERS_SETTING_KEY)),
        Date.now(),
      );
      await refreshNotificationPermission();
      if (cancelled) return;

      /**
       * 提醒调度（SC-017 / §12）：与 WebCal 刷新同一条形状——一个指向
       * “下一条提醒”的定时器，外加每个自然日一次的跨天重算（窗口跟着日期
       * 滑动），没有轮询。已处理状态落盘在快照里，重启后由上面的日志恢复。
       */
      const reminders = createNotificationScheduler({
        plan: buildReminderPlan,
        replan: buildReminderPlan,
        send: async (reminder) => {
          await notificationBridge.send({
            title: reminder.title,
            body: reminder.body,
          });
          // 发送成功即清掉上一次的失败说明：状态行说的是当前事实（§13）。
          setNotificationProblem(undefined);
        },
        mark: markReminderProcessed,
        onError: (error) => {
          setNotificationProblem(describeNotificationFailure(error));
          if (isPermissionDeniedFailure(error)) {
            setNotificationPermission("denied");
          }
        },
        onPlanChange: () => {
          setReminderSummary({
            pending: reminders.pendingCount(),
            next: reminders.nextReminder(),
          });
        },
      });
      reminderSchedulerRef.current = reminders;
      reminders.start();

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
      reminderSchedulerRef.current?.stop();
      reminderSchedulerRef.current = null;
    };
    // 回调身份稳定（useCallback），该 effect 实际只在挂载时执行一次。
  }, [
    markRefreshing,
    pushCloseBehavior,
    refreshFromStore,
    refreshSubscription,
    markReminderProcessed,
    refreshNotificationPermission,
    buildReminderPlan,
  ]);

  /**
   * 添加订阅（SC-007 / SRC-002）：地址归一化 → 建源 → 立即抓取一次。
   * 返回是否创建成功，供侧栏决定是否清空输入。
   */
  async function handleAddSubscription(url: string): Promise<boolean> {
    const store = storeRef.current;
    if (!store) {
      setSubscriptionStatus(PREVIEW_SUBSCRIBE_HINT);
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
      setSubscriptionStatus(PREVIEW_SUBSCRIBE_HINT);
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
    const name = store.getSource(sourceId)?.name ?? "该来源";
    if (!store.setSourceEnabled(sourceId, enabled)) {
      return;
    }
    await store.save();
    refreshFromStore(store);
    schedulerRef.current?.reschedule();
    setSubscriptionStatus(
      enabled ? `已显示「${name}」` : `已隐藏「${name}」（事件保留）`,
    );
  }

  /** 删除来源：连同其事件与增强结果一起删除（级联，本地导入与订阅同一条路径）。 */
  async function handleRemoveSource(sourceId: string) {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    const name = store.getSource(sourceId)?.name ?? "来源";
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

  /**
   * 主题（SC-018 搬进设置页）：选中即生效并落盘。
   * 选中的就是当前值时不重复写快照（控件是二值选择，不是切换开关）。
   */
  async function handleChangeTheme(next: Theme) {
    if (next === theme) {
      return;
    }
    setTheme(next);
    applyTheme(next);
    await persistSetting(THEME_SETTING_KEY, next);
  }

  /**
   * 内置来源显示开关（SC-018）：状态立即生效（展示层按开关取载荷与事件），
   * 再落盘。关闭不删数据——打开即恢复原样。
   */
  async function handleToggleBuiltinSource(
    id: BuiltinSourceId,
    enabled: boolean,
  ) {
    const next = toggleBuiltinSource(hiddenBuiltinSourceIds, id, enabled);
    setHiddenBuiltinSourceIds(next);
    await persistSetting(BUILTIN_SOURCES_SETTING_KEY, next);
    // 英超开关会改变提醒计划的输入，立即按最新事件重排（§12 无轮询）。
    reminderSchedulerRef.current?.reschedule();
  }

  /**
   * WebCal 刷新间隔（SC-018 / §12）：写设置 + 让调度器按新间隔重排，
   * 因此“即时生效”而不是等下一次启动。
   */
  async function handleChangeWebcalInterval(minutes: number) {
    const next = normalizeWebcalIntervalMinutes(minutes);
    setWebcalIntervalMinutes(next);
    webcalIntervalRef.current = next;
    await persistSetting(WEBCAL_INTERVAL_SETTING_KEY, next);
    schedulerRef.current?.reschedule();
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
   * 通知总开关（NOTIFY-001）：开启时顺带向系统请求一次权限——
   * 这是权限请求的唯一触发点（另外还有用户显式点的“请求系统授权”），
   * 不在后台反复询问。关闭后计划立即清空，调度器随之释放定时器。
   */
  async function handleToggleNotifications(enabled: boolean) {
    setNotificationsEnabled(enabled);
    setNotificationProblem(undefined);
    await persistSetting(NOTIFICATIONS_ENABLED_SETTING_KEY, enabled);
    if (enabled && notificationPermission !== "granted") {
      await requestNotificationPermission();
    }
    reminderSchedulerRef.current?.reschedule();
  }

  /**
   * 比赛提醒提前量（NOTIFY-003）：用户设置优先于 Resolver 建议。
   * “跟随默认”写回 undefined（快照里没有该键），因此默认值只有 Resolver 一处。
   */
  async function handleChangeMatchReminder(next: MatchReminderSetting) {
    setMatchReminder(next);
    await persistSetting(MATCH_REMINDER_SETTING_KEY, next);
    reminderSchedulerRef.current?.reschedule();
  }

  /**
   * 导入本地 ICS（SC-006 / SRC-001）：文件选择 → 解析 → 落库 → 匹配 → 刷新。
   * 解析错误按事件隔离后聚合反馈（ICS-005），异常也不中断月视图。
   */
  async function handleImportIcs(file: File) {
    const store = storeRef.current;
    if (!store) {
      setImportStatus(PREVIEW_IMPORT_HINT);
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

  /**
   * 通知设置与权限状态（SC-017）：设置页与调度链路共用同一份载荷，
   * 界面上的说法与真正会发生的事不会矛盾。
   */
  const notificationProps = {
    enabled: notificationsEnabled,
    onToggleEnabled: handleToggleNotifications,
    matchReminder,
    onChangeMatchReminder: handleChangeMatchReminder,
    ...(MATCH_REMINDER_DEFAULT_LABEL === undefined
      ? {}
      : { matchReminderDefaultLabel: MATCH_REMINDER_DEFAULT_LABEL }),
    permission: notificationPermission,
    status: describeNotificationStatus({
      enabled: notificationsEnabled,
      permission: notificationPermission,
      pendingCount: reminderSummary.pending,
      next: reminderSummary.next,
      nowMs: Date.now(),
      ...(notificationProblem === undefined
        ? {}
        : { problem: notificationProblem }),
    }),
    canRequestPermission: canRequestNotificationPermission(
      notificationPermission,
      notificationsEnabled,
    ),
    onRequestPermission: () => {
      void requestNotificationPermission();
    },
  };

  return (
    <AppShell
      sidebar={
        <Sidebar
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
          subscribeBusy={subscribeBusy}
          refreshingSourceIds={refreshingSourceIds}
          subscriptionStatus={subscriptionStatus}
          hiddenBuiltinSourceIds={hiddenBuiltinSourceIds}
          onToggleBuiltinSource={handleToggleBuiltinSource}
          followableTeams={followableTeams}
          followedTeamIds={followedTeamIds}
          onToggleFollowedTeam={handleToggleFollowedTeam}
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      }
      inspector={
        <InspectorPanel
          dateKey={selectedDateKey}
          events={selectedEvents}
          lunar={lunarByDate.get(selectedDateKey)}
          chinaDay={visibleChinaDayByDate.get(selectedDateKey)}
          chinaSemantic={visibleChinaSemanticByDate.get(selectedDateKey)}
          followedTeamIds={followedTeamIds}
          matchReminder={matchReminder}
        />
      }
    >
      {settingsOpen ? (
        <SettingsView
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onChangeTheme={handleChangeTheme}
          dataSources={{
            hiddenBuiltinSourceIds,
            onToggleBuiltinSource: handleToggleBuiltinSource,
            sources,
            refreshingSourceIds,
            onRefreshSource: handleRefreshSubscription,
            onRemoveSource: handleRemoveSource,
            webcalIntervalMinutes,
            onChangeWebcalInterval: handleChangeWebcalInterval,
            ...(subscriptionStatus === undefined
              ? {}
              : { sourceStatus: subscriptionStatus }),
          }}
          previewMode={previewMode}
          followableTeams={followableTeams}
          followedTeamIds={followedTeamIds}
          onToggleFollowedTeam={handleToggleFollowedTeam}
          notifications={notificationProps}
          closeBehavior={closeBehavior}
          onChangeCloseBehavior={handleChangeCloseBehavior}
          closeBehaviorStatus={closeBehaviorStatus}
        />
      ) : (
        <MonthView
          grid={grid}
          selectedDateKey={selectedDateKey}
          onSelectDate={selectDate}
          onStepMonth={stepMonth}
          onGoToToday={goToToday}
          onStepSelection={stepSelection}
          eventsByDate={eventsByDate}
          lunarByDate={lunarByDate}
          chinaDayByDate={visibleChinaDayByDate}
          chinaSemanticByDate={visibleChinaSemanticByDate}
        />
      )}
    </AppShell>
  );
}
