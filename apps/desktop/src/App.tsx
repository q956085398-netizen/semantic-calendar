import { useEffect, useMemo, useRef, useState } from "react";
import { buildMonthGrid, todayKeyFromDate } from "./calendar/month-grid";
import { MonthView } from "./calendar/MonthView";
import { openDesktopCalendarStore } from "./data/desktop-store";
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

  const grid = useMemo(
    () =>
      buildMonthGrid({
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        today: todayKeyFromDate(today),
      }),
    [today],
  );

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

  return (
    <AppShell
      sidebar={
        <Sidebar
          theme={theme}
          onToggleTheme={handleToggleTheme}
          storeStatus={storeStatus}
        />
      }
      inspector={<InspectorPanel date={today} />}
    >
      <MonthView grid={grid} />
    </AppShell>
  );
}
