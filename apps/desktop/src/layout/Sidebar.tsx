import type { Theme } from "../theme/theme";

/**
 * 左侧栏（ui-design §4）：品牌区 + 数据源列表 + 主题切换。
 *
 * v0.1 骨架阶段数据源为静态展示：真实来源由 SC-006 / SC-007 创建，
 * 显示开关与设置入口由 SC-018 接线。小月历随 SC-005 的导航状态加入。
 */

interface SidebarProps {
  theme: Theme;
  onToggleTheme: () => void;
  /** 本地数据层状态（含预览模式 / 恢复提示），保证降级可见（app-spec §13）。 */
  storeStatus: string;
}

interface SourceRow {
  id: string;
  name: string;
  /** 语义色，仅作来源识别；同一信息仍以文字呈现，不靠颜色单独区分。 */
  color: string;
}

const SOURCE_ROWS: SourceRow[] = [
  { id: "mine", name: "我的日历", color: "var(--source-personal)" },
  { id: "cn-holiday", name: "中国节假日", color: "var(--source-holiday)" },
  { id: "solar-terms", name: "二十四节气", color: "var(--source-solar)" },
  { id: "premier-league", name: "英超赛程", color: "var(--source-sport)" },
];

export function Sidebar({ theme, onToggleTheme, storeStatus }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="app-icon" aria-hidden="true">
          日
        </span>
        <span className="brand-name">语义日历</span>
      </div>

      <nav className="sidebar-section" aria-labelledby="sidebar-sources">
        <h2 id="sidebar-sources" className="sidebar-heading">
          数据源
        </h2>
        <ul className="source-list">
          {SOURCE_ROWS.map((source) => (
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
