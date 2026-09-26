import type { ReactNode } from "react";
import { APP_NAME_ZH } from "../settings/app-info";
import { FollowedTeamsPicker } from "./FollowedTeamsPicker";
import type { FixtureTeamDisplay } from "../semantic/metadata-resolver";
import type { CalendarSource } from "../data/model";
import {
  BUILTIN_SOURCES,
  isBuiltinSourceEnabled,
  type BuiltinSourceId,
} from "../settings/builtin-sources";
import { sourceColor, sourceDisplayName } from "./source-display";

/** 常驻导航只显示日历名称与开关，地址与管理动作放在设置中。 */
interface SidebarProps {
  sources: readonly CalendarSource[];
  onToggleSource: (id: string, enabled: boolean) => void;
  hiddenBuiltinSourceIds: readonly BuiltinSourceId[];
  onToggleBuiltinSource: (id: BuiltinSourceId, enabled: boolean) => void;
  storeStatus: string;
  storeProblem?: string;
  miniCalendar: ReactNode;
  followableTeams: FixtureTeamDisplay[];
  followedTeamIds: readonly string[];
  onToggleFollowedTeam: (teamId: string, followed: boolean) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
}

export function Sidebar({
  sources,
  onToggleSource,
  hiddenBuiltinSourceIds,
  onToggleBuiltinSource,
  storeStatus,
  storeProblem,
  miniCalendar,
  followableTeams,
  followedTeamIds,
  onToggleFollowedTeam,
  settingsOpen,
  onOpenSettings,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="app-icon" aria-hidden="true">
          历
        </span>
        <span className="brand-name">{APP_NAME_ZH}</span>
      </div>
      {miniCalendar}
      <div className="sidebar-calendar-controls">
        <section aria-label="显示日历">
          <h3 className="sidebar-heading">显示日历</h3>
          <ul className="source-list sidebar-source-list">
            {BUILTIN_SOURCES.map((source) => (
              <li className="source-item" key={source.id}>
                <label className="source-toggle" title={source.description}>
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
                  <span className="source-name">{source.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        {sources.length > 0 && (
          <section aria-label="导入与订阅日历">
            <h3 className="sidebar-heading">导入与订阅</h3>
            <ul className="source-list sidebar-source-list">
              {sources.map((source) => (
                <li className="source-item" key={source.id}>
                  <label
                    className="source-toggle"
                    title={sourceDisplayName(source)}
                  >
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
                    <span className="source-name">
                      {sourceDisplayName(source)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        <FollowedTeamsPicker
          teams={followableTeams}
          followedIds={followedTeamIds}
          onToggleTeam={onToggleFollowedTeam}
        />
      </div>
      <div className="sidebar-footer">
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
        {storeProblem && (
          <p className="store-status" role="status">
            {storeProblem}
          </p>
        )}
      </div>
    </div>
  );
}
