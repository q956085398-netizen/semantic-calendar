import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../data/model";
import {
  BUILTIN_SOURCES,
  isBuiltinSourceEnabled,
  type BuiltinSourceId,
} from "../settings/builtin-sources";

/**
 * 内置来源的识别色：与 ui-design §4.3 的四行一一对应，固定不派生——
 * 内置来源是产品自带的内容层，颜色不随导入来源变化。
 */
const BUILTIN_SOURCE_COLORS: Record<BuiltinSourceId, string> = {
  mine: "var(--source-personal)",
  "cn-holiday": "var(--source-holiday)",
  "solar-terms": "var(--source-solar)",
  "premier-league": "var(--source-sport)",
};
import { FollowedTeamsPicker } from "./FollowedTeamsPicker";
import { sourceColor, sourceStatusText } from "./source-display";
import type { FixtureTeamDisplay } from "../semantic/metadata-resolver";

/**
 * 左侧栏（ui-design §4）：品牌区 + 小月历 + 数据源列表 + 关注球队 + 导入 / 订阅 + 设置入口。
 *
 * 小月历由 App 注入（SC-005），与主视图共享导航状态。
 * SC-006 起列出真实导入的本地 ICS 数据源；
 * SC-007 起列出 WebCal 订阅，并可刷新（SRC-002 / SRC-003）；
 * SC-016 起提供关注球队选择（SPORT-006），持久化由 App 负责；
 * SC-018 起数据源列表承担「显示 / 隐藏」（§4 第 2 项）：内置四行是内置来源开关
 *   （与设置页同一份设置），导入 / 订阅行是各自来源的启用状态；每行的
 *   刷新仍在行内，删除等需要确认的管理动作集中到设置页；
 *   主题、关闭窗口行为、通知这组设置搬进设置页（§4 第 5 项），侧栏底部
 *   只留一个设置入口与数据层状态——同一个状态只有一个控件，避免两处各写一份。
 */

interface SidebarProps {
  /** 本地数据层状态（含预览模式 / 恢复提示），保证降级可见（app-spec §13）。 */
  storeStatus: string;
  /** 小月历（SC-005）：与主视图联动的导航件。 */
  miniCalendar: ReactNode;
  /** 真实数据源（SC-006 导入的 local-ics 源与 SC-007 订阅）。 */
  sources: CalendarSource[];
  /** 选择本地 .ics 文件后的回调（解析与落库在 App 统一处理）。 */
  onImportIcs: (file: File) => void;
  /** 导入进行中：禁用入口，防连点。 */
  importBusy: boolean;
  /** 上次导入的结果或错误说明。 */
  importStatus?: string;
  /** 添加订阅；返回是否创建成功，失败时保留输入内容便于修正。 */
  onAddSubscription: (url: string) => Promise<boolean>;
  /** 手动刷新某个订阅。 */
  onRefreshSubscription: (sourceId: string) => void;
  /** 启用 / 停用来源（行内的显示开关）。 */
  onToggleSource: (sourceId: string, enabled: boolean) => void;
  /** 添加订阅进行中。 */
  subscribeBusy: boolean;
  /** 正在刷新的来源 id（含后台刷新）。 */
  refreshingSourceIds: readonly string[];
  /** 订阅操作的结果或错误说明。 */
  subscriptionStatus?: string;
  /** 被隐藏的内置来源 id（SC-018）：缺省即显示。 */
  hiddenBuiltinSourceIds: readonly BuiltinSourceId[];
  onToggleBuiltinSource: (id: BuiltinSourceId, enabled: boolean) => void;
  /** 可关注球队（SC-016）：由 App 从元数据层注入，侧栏不做球队匹配。 */
  followableTeams: FixtureTeamDisplay[];
  /** 已关注的球队 id（SC-016 持久化状态）。 */
  followedTeamIds: readonly string[];
  /** 关注 / 取消关注。 */
  onToggleFollowedTeam: (teamId: string, followed: boolean) => void;
  /** 设置页入口（SC-018）：完整偏好在设置页，侧栏只负责打开它。 */
  settingsOpen: boolean;
  onOpenSettings: () => void;
}

export function Sidebar({
  storeStatus,
  miniCalendar,
  sources,
  onImportIcs,
  importBusy,
  importStatus,
  onAddSubscription,
  onRefreshSubscription,
  onToggleSource,
  subscribeBusy,
  refreshingSourceIds,
  subscriptionStatus,
  hiddenBuiltinSourceIds,
  onToggleBuiltinSource,
  followableTeams,
  followedTeamIds,
  onToggleFollowedTeam,
  settingsOpen,
  onOpenSettings,
}: SidebarProps) {
  const [draftUrl, setDraftUrl] = useState("");

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      onImportIcs(file);
    }
    // 允许再次选择同一文件（重导入走 update 路径，不产生副本）。
    event.target.value = "";
  }

  async function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = draftUrl.trim();
    if (url === "" || subscribeBusy) {
      return;
    }
    // 只有真正创建成功才清空输入，地址写错时保留内容供修正。
    if (await onAddSubscription(url)) {
      setDraftUrl("");
    }
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
        {/* 显示 / 隐藏（§4 第 2 项）：勾选框是这一行的显示开关，状态文字仍说明
            “为什么现在看不到”（已停用 / 刷新失败），不靠勾选框单独传达。 */}
        <ul className="source-list">
          {sources.map((source) => {
            const refreshing = refreshingSourceIds.includes(source.id);
            return (
              <li key={source.id} className="source-item is-imported">
                <label className="source-toggle">
                  <input
                    type="checkbox"
                    className="source-check"
                    checked={source.enabled}
                    onChange={(event) =>
                      onToggleSource(source.id, event.target.checked)
                    }
                  />
                  <span
                    className="source-dot"
                    style={{ background: sourceColor(source.id) }}
                    aria-hidden="true"
                  />
                  <span className="source-name">{source.name}</span>
                </label>
                <div className="source-body">
                  <span className="source-status" role="status">
                    {sourceStatusText(source, refreshing)}
                  </span>
                  {source.type === WEBCAL_SOURCE_TYPE && (
                    <span className="source-actions">
                      <button
                        type="button"
                        className="source-action"
                        onClick={() => onRefreshSubscription(source.id)}
                        disabled={refreshing}
                      >
                        刷新
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {BUILTIN_SOURCES.map((source) => (
            <li key={source.id} className="source-item">
              <label className="source-toggle">
                <input
                  type="checkbox"
                  className="source-check"
                  checked={isBuiltinSourceEnabled(
                    hiddenBuiltinSourceIds,
                    source.id,
                  )}
                  onChange={(event) =>
                    onToggleBuiltinSource(source.id, event.target.checked)
                  }
                />
                <span
                  className="source-dot"
                  style={{ background: BUILTIN_SOURCE_COLORS[source.id] }}
                  aria-hidden="true"
                />
                <span className="source-name">{source.name}</span>
              </label>
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

        <form className="subscribe-form" onSubmit={handleSubscribe}>
          <label className="subscribe-label" htmlFor="subscribe-url">
            订阅 ICS / WebCal 地址…
          </label>
          <div className="subscribe-row">
            <input
              id="subscribe-url"
              className="subscribe-input"
              type="text"
              inputMode="url"
              placeholder="https://example.com/calendar.ics"
              value={draftUrl}
              onChange={(event) => setDraftUrl(event.target.value)}
              disabled={subscribeBusy}
            />
            <button
              type="submit"
              className="subscribe-submit"
              disabled={subscribeBusy || draftUrl.trim() === ""}
            >
              {subscribeBusy ? "添加中…" : "添加"}
            </button>
          </div>
        </form>

        {importStatus && (
          <p className="store-status" role="status">
            {importStatus}
          </p>
        )}
        {subscriptionStatus && (
          <p className="store-status" role="status">
            {subscriptionStatus}
          </p>
        )}
      </nav>

      <FollowedTeamsPicker
        teams={followableTeams}
        followedIds={followedTeamIds}
        onToggleTeam={onToggleFollowedTeam}
      />

      <div className="sidebar-footer">
        {/* 设置入口（§4 第 5 项）：主题、数据源管理、关注球队、通知与窗口
            行为都在设置页，这里的按钮只负责打开它（打开状态不持久化，
            每次启动都从月视图开始——月历是主界面，P-05）。 */}
        <button
          type="button"
          className="settings-entry"
          aria-pressed={settingsOpen}
          onClick={onOpenSettings}
        >
          设置
        </button>
        <p className="store-status" role="status">
          {storeStatus}
        </p>
      </div>
    </div>
  );
}
