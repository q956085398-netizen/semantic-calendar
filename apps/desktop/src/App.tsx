import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openDesktopCalendarStore } from "./data/desktop-store";
import type { StoreRecoveryReason } from "./data/store/calendar-store";

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
  const [status, setStatus] = useState("桌面工作区已就绪");
  const [storeStatus, setStoreStatus] = useState("正在初始化本地数据层…");

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

  async function verifyIpc() {
    try {
      const message = await invoke<string>("greet", {
        name: "Semantic Calendar",
      });
      setStatus(message);
    } catch {
      setStatus("浏览器预览模式：Tauri IPC 仅在桌面壳中可用");
    }
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">Semantic Calendar · v0.1 bootstrap</p>
        <h1 id="app-title">语义日历</h1>
        <p className="subtitle">
          本地优先的桌面日历。当前工单建立事件模型、本地持久化与最小 IPC 链路。
        </p>
        <button type="button" onClick={verifyIpc}>
          验证桌面 IPC
        </button>
        <output aria-live="polite">{status}</output>
        <p className="store-status">{storeStatus}</p>
      </section>
    </main>
  );
}
