import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  buildMonthGrid,
  parseDateKey,
  shiftDateKey,
  todayKeyFromDate,
  type YearMonth,
} from "./calendar/month-grid";
import { bucketEventsByDateKey } from "./calendar/event-buckets";
import { MiniMonth } from "./calendar/MiniMonth";
import { MonthView } from "./calendar/MonthView";
import { openDesktopCalendarStore } from "./data/desktop-store";
import type { CalendarSource, EnrichedEvent } from "./data/model";
import {
  importLocalIcs,
  type LocalIcsImportOutcome,
} from "./data/import/import-local-ics";
import type { CalendarStore } from "./data/store/calendar-store";
import type { StoreRecoveryReason } from "./data/store/calendar-store";
import { AppShell } from "./layout/AppShell";
import { InspectorPanel } from "./layout/InspectorPanel";
import { Sidebar } from "./layout/Sidebar";
import {
  THEME_SETTING_KEY,
  applyTheme,
  normalizeTheme,
  toggleTheme,
  type Theme,
} from "./theme/theme";

const LAST_OPENED_SETTING = "app.lastOpenedAt";

const REASON_LABELS: Record<StoreRecoveryReason, string> = {
  "corrupt-json": "文件损坏",
  "invalid-shape": "结构异常",
  "future-version": "来自更新版本的应用",
};

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

function formatLaunchTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [storeStatus, setStoreStatus] = useState("正在初始化本地数据层…");
  const storeRef = useRef<CalendarStore | null>(null);
  const [today] = useState(() => new Date());

  // 数据源与事件（SC-006）：从本地数据层读出，导入后刷新。
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [importStatus, setImportStatus] = useState<string | undefined>();
  const [importBusy, setImportBusy] = useState(false);

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
  const eventsByDate = useMemo(() => bucketEventsByDateKey(events), [events]);
  const selectedEvents = eventsByDate.get(selectedDateKey) ?? [];

  /** 从本地数据层重建 UI 状态；只显示启用来源的事件（SRC-003）。 */
  function refreshFromStore(store: CalendarStore) {
    const nextSources = store.listSources();
    const enabled = new Set(
      nextSources.filter((source) => source.enabled).map((source) => source.id),
    );
    setSources(nextSources);
    setEvents(
      store.listEnrichedEvents().filter((event) => enabled.has(event.sourceId)),
    );
  }

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
      refreshFromStore(store);

      const savedTheme = normalizeTheme(store.getSetting(THEME_SETTING_KEY));
      applyTheme(savedTheme);
      setTheme(savedTheme);

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
          ? `本地数据层就绪（${version}），上次启动 ${formatLaunchTime(previous)}`
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
    };
  }, []);

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

    const store = storeRef.current;
    if (store) {
      store.setSetting(THEME_SETTING_KEY, next);
      await store.save();
    }
  }

  /**
   * 导入本地 ICS（SC-006 / SRC-001）：文件选择 → 解析 → 落库 → 刷新。
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
        />
      }
      inspector={
        <InspectorPanel dateKey={selectedDateKey} events={selectedEvents} />
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
      />
    </AppShell>
  );
}
