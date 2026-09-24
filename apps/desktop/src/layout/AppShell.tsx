import { useEffect, useState, type ReactNode } from "react";

/**
 * 桌面三栏骨架（ui-design §2）：Sidebar | Calendar | Inspector。
 *
 * CAL-004：左右栏可折叠；窗口缩小时月历主区域始终保留。
 * - 折叠后面板保持挂载、以 hidden 隐藏，aria-controls 始终指向真实节点；
 * - 窄窗口按 §23 的顺序自动收起：先右栏，再左栏；跨过阈值时重置，
 *   同一带宽内手动展开 / 收起仍然有效（事件驱动的 matchMedia，无轮询）。
 */

interface AppShellProps {
  sidebar: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
}

const SIDEBAR_PANE_ID = "app-sidebar";
const INSPECTOR_PANE_ID = "app-inspector";

/**
 * 自动折叠阈值（px）：右栏在 1080px 收起，左栏在 880px 收起。
 *
 * 这两个数字与 tauri.conf.json 的窗口最小宽度是一份契约：最小宽度必须
 * 落在左栏阈值之内，这样窗口缩到最小尺寸时两侧面板都已收起，月历主体
 * 仍然完整可用（ui-design §23 的“最窄允许范围”）。契约由
 * `window-size-contract.test.ts` 守住。
 */
export const NARROW_LAYOUT_THRESHOLDS = {
  inspector: 1080,
  sidebar: 880,
} as const;

const INSPECTOR_NARROW_QUERY = `(max-width: ${NARROW_LAYOUT_THRESHOLDS.inspector}px)`;
const SIDEBAR_NARROW_QUERY = `(max-width: ${NARROW_LAYOUT_THRESHOLDS.sidebar}px)`;

interface CollapsiblePaneProps {
  id: string;
  /** 无障碍名称（侧栏 / 详情栏）。 */
  label: string;
  collapseTitle: string;
  className: string;
  open: boolean;
  onCollapse: () => void;
  children: ReactNode;
}

function CollapsiblePane({
  id,
  label,
  collapseTitle,
  className,
  open,
  onCollapse,
  children,
}: CollapsiblePaneProps) {
  return (
    <aside
      id={id}
      className={`pane ${className}`}
      aria-label={label}
      hidden={!open}
    >
      {children}
      <button
        type="button"
        className="pane-toggle pane-toggle-collapse"
        aria-expanded="true"
        aria-controls={id}
        onClick={onCollapse}
      >
        {collapseTitle}
      </button>
    </aside>
  );
}

interface PaneRailProps {
  paneId: string;
  title: string;
  className: string;
  onExpand: () => void;
}

function PaneRail({ paneId, title, className, onExpand }: PaneRailProps) {
  return (
    <button
      type="button"
      className={`pane-toggle rail ${className}`}
      aria-expanded="false"
      aria-controls={paneId}
      onClick={onExpand}
    >
      {title}
    </button>
  );
}

export function AppShell({ sidebar, inspector, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const inspectorQuery = window.matchMedia(INSPECTOR_NARROW_QUERY);
    const sidebarQuery = window.matchMedia(SIDEBAR_NARROW_QUERY);
    const syncWithViewport = () => {
      setInspectorOpen(!inspectorQuery.matches);
      setSidebarOpen(!sidebarQuery.matches);
    };
    syncWithViewport();
    inspectorQuery.addEventListener("change", syncWithViewport);
    sidebarQuery.addEventListener("change", syncWithViewport);
    return () => {
      inspectorQuery.removeEventListener("change", syncWithViewport);
      sidebarQuery.removeEventListener("change", syncWithViewport);
    };
  }, []);

  const shellClass = [
    "app-shell",
    sidebarOpen ? "" : "sidebar-collapsed",
    inspectorOpen ? "" : "inspector-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <CollapsiblePane
        id={SIDEBAR_PANE_ID}
        label="侧栏"
        collapseTitle="收起侧栏"
        className="pane-sidebar"
        open={sidebarOpen}
        onCollapse={() => setSidebarOpen(false)}
      >
        {sidebar}
      </CollapsiblePane>
      {!sidebarOpen && (
        <PaneRail
          paneId={SIDEBAR_PANE_ID}
          title="展开侧栏"
          className="rail-sidebar"
          onExpand={() => setSidebarOpen(true)}
        />
      )}

      <main className="pane pane-calendar">{children}</main>

      <CollapsiblePane
        id={INSPECTOR_PANE_ID}
        label="详情栏"
        collapseTitle="收起详情"
        className="pane-inspector"
        open={inspectorOpen}
        onCollapse={() => setInspectorOpen(false)}
      >
        {inspector}
      </CollapsiblePane>
      {!inspectorOpen && (
        <PaneRail
          paneId={INSPECTOR_PANE_ID}
          title="展开详情"
          className="rail-inspector"
          onExpand={() => setInspectorOpen(true)}
        />
      )}
    </div>
  );
}
