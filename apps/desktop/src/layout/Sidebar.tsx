import type { ChangeEvent, ReactNode } from "react";
import type { CalendarSource } from "../data/model";
import type { Theme } from "../theme/theme";

/**
 * 左侧栏（ui-design §4）：品牌区 + 小月历 + 数据源列表 + 导入 + 主题切换。
 *
 * 小月历由 App 注入（SC-005），与主视图共享导航状态。
 * SC-006 起列出真实导入的本地 ICS 数据源；内置行（节假日 / 节气 / 英超）
 * 仍是静态占位，由 SC-011 / SC-012 / SC-016 提供数据，
 * 显示开关与设置入口由 SC-018 接线。
 */

interface SidebarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /** 本地数据层状态（含预览模式 / 恢复提示），保证降级可见（app-spec §13）。 */
  storeStatus: string;
  /** 小月历（SC-005）：与主视图联动的导航件。 */
  miniCalendar: ReactNode;
  /** 真实数据源（SC-006 导入的 local-ics 源）。 */
  sources: CalendarSource[];
  /** 选择本地 .ics 文件后的回调（解析与落库在 App 统一处理）。 */
  onImportIcs: (file: File) => void;
  /** 导入进行中：禁用入口，防连点。 */
  importBusy: boolean;
  /** 上次导入的结果或错误说明。 */
  importStatus?: string;
}

interface StaticSourceRow {
  id: string;
  name: string;
  /** 语义色，仅作来源识别；同一信息仍以文字呈现，不靠颜色单独区分。 */
  color: string;
}

const STATIC_SOURCE_ROWS: StaticSourceRow[] = [
  { id: "mine", name: "我的日历", color: "var(--source-personal)" },
  { id: "cn-holiday", name: "中国节假日", color: "var(--source-holiday)" },
  { id: "solar-terms", name: "二十四节气", color: "var(--source-solar)" },
  { id: "premier-league", name: "英超赛程", color: "var(--source-sport)" },
];

/** 导入源识别色：按 id 派生（增删其他来源不会改变既有颜色）。 */
const SOURCE_COLORS = [
  "var(--source-personal)",
  "var(--source-sport)",
  "var(--source-solar)",
  "var(--source-holiday)",
];

function sourceColor(sourceId: string): string {
  let hash = 0;
  for (const char of sourceId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return SOURCE_COLORS[Math.abs(hash) % SOURCE_COLORS.length];
}

export function Sidebar({
  theme,
  onToggleTheme,
  storeStatus,
  miniCalendar,
  sources,
  onImportIcs,
  importBusy,
  importStatus,
}: SidebarProps) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      onImportIcs(file);
    }
    // 允许再次选择同一文件（重导入走 update 路径，不产生副本）。
    event.target.value = "";
  }

  return (
    <div className="sidebar">
      <div className="brand">
        <span className="app-icon" aria-hidden="true">
          日
        </span>
        <span className="brand-name">语义日历</span>
      </div>

      {miniCalendar}

      <nav className="sidebar-section" aria-labelledby="sidebar-sources">
        <h2 id="sidebar-sources" className="sidebar-heading">
          数据源
        </h2>
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.id} className="source-item is-imported">
              <span
                className="source-dot"
                style={{ background: sourceColor(source.id) }}
                aria-hidden="true"
              />
              <span className="source-name">{source.name}</span>
            </li>
          ))}
          {STATIC_SOURCE_ROWS.map((source) => (
            <li key={source.id} className="source-item">
              <span
                className="source-dot"
                style={{ background: source.color }}
                aria-hidden="true"
              />
              <span className="source-name">{source.name}</span>
            </li>
          ))}
        </ul>

        <label className={`import-button${importBusy ? " is-busy" : ""}`}>
          导入 ICS 文件…
          <input
            type="file"
            accept=".ics,text/calendar"
            className="file-input-hidden"
            onChange={handleFileChange}
            disabled={importBusy}
          />
        </label>
        {importStatus && (
          <p className="store-status" role="status">
            {importStatus}
          </p>
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-pressed={theme === "dark"}
        >
          {theme === "dark" ? "切换浅色主题" : "切换深色主题"}
        </button>
        <p className="store-status" role="status">
          {storeStatus}
        </p>
      </div>
    </div>
  );
}
