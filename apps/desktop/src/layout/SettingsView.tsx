import { WEBCAL_SOURCE_TYPE, type CalendarSource } from "../data/model";
import {
  BUILTIN_SOURCES,
  isBuiltinSourceEnabled,
  type BuiltinSourceId,
} from "../settings/builtin-sources";
import {
  WEBCAL_INTERVAL_OPTIONS,
  describeWebcalRefreshPolicy,
} from "../settings/webcal-interval";
import { REGION_FACTS, REGION_RESERVED_NOTE } from "../settings/region";
import {
  CLOSE_BEHAVIOR_OPTIONS,
  describeCloseBehavior,
  type CloseBehavior,
} from "../shell/close-behavior";
import type { Theme } from "../theme/theme";
import {
  matchReminderOptionValue,
  matchReminderOptionsFor,
  matchReminderSettingFromOption,
  type MatchReminderSetting,
} from "../notifications/notification-settings";
import type { NotificationPermissionState } from "../notifications/notification-bridge";
import {
  describeSourceRemoval,
  sourceColor,
  sourceStatusText,
} from "./source-display";
import { FollowedTeamsPicker } from "./FollowedTeamsPicker";
import type { FixtureTeamDisplay } from "../semantic/metadata-resolver";

/**
 * 设置页（SC-018 / app-spec §9 SETTINGS、ui-design §4 第 5 项）。
 *
 * 一个轻量页面，不做多层后台、不做 Dashboard（验收：设置页面不演变为
 * Dashboard）：左栏仍是常驻导航与显示开关，这里只集中 v0.1 的必要偏好
 * ——外观、区域（预留）、数据源、关注球队、通知、窗口行为。
 *
 * 与侧栏的分工：可见 / 隐藏这类日常开关在侧栏数据源列表（ui-design §4 第 2 项、§4.3），
 * 需要确认或较少改动的管理动作（删除来源）与偏好集中在这里。同一个状态
 * 只有一个来源（App 持有的设置 + 快照），两处界面不会各自记一份。
 *
 * 所有控件即时生效：改主题、删来源、改间隔都立刻反映到界面或调度上，
 * 因此没有“需要重启”的提示——确实需要重启的行为在这里不存在。
 */

/** 通知一组设置与状态（SC-017）：设置页只渲染，不决定语义。 */
export interface SettingsNotificationsProps {
  /** 通知总开关（NOTIFY-001）。 */
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  /** 比赛提醒提前量（NOTIFY-003）：跟随默认 / 分钟数 / 不提醒。 */
  matchReminder: MatchReminderSetting;
  onChangeMatchReminder: (setting: MatchReminderSetting) => void;
  /** Resolver 的默认建议文案，用于“跟随默认建议（…）”，避免再写一份默认值。 */
  matchReminderDefaultLabel?: string;
  /** 系统通知权限状态（供样式与测试挂钩）。 */
  permission: NotificationPermissionState | "unknown";
  /** 状态行文案（notifications/notification-status 的输出）。 */
  status: string;
  /** 是否提供“请求系统授权”入口（权限待确认或被拒绝时）。 */
  canRequestPermission: boolean;
  onRequestPermission: () => void;
}

interface ThemeOption {
  value: Theme;
  label: string;
  hint: string;
}

/** 主题是二值选择，与关闭窗口行为同样用分段控件表达（不靠颜色单独传达）。 */
const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "浅色", hint: "浅色主题：暖灰界面，日历区最亮" },
  { value: "dark", label: "深色", hint: "深色主题：同一套信息架构的暗色取值" },
];

interface SettingsViewProps {
  /** 返回月视图（设置页不是常驻视图，关闭状态不持久化）。 */
  onClose: () => void;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  /** 数据源一节的全部输入（内置开关 + 来源管理 + 刷新间隔）。 */
  dataSources: SettingsDataSourcesProps;
  /**
   * 数据层提示（SC-019）：预览模式 / 初始化失败各有说法，正常运行时不传
   * ——措辞由 `layout/data-layer-status.ts` 统一给出，这里只负责显示。
   */
  dataLayerHint?: string;
  /** 最近一次落盘失败说明（SC-019）：改动没写进磁盘时要说出来。 */
  storeProblem?: string;
  followableTeams: FixtureTeamDisplay[];
  followedTeamIds: readonly string[];
  onToggleFollowedTeam: (teamId: string, followed: boolean) => void;
  notifications: SettingsNotificationsProps;
  closeBehavior: CloseBehavior;
  onChangeCloseBehavior: (behavior: CloseBehavior) => void;
  closeBehaviorStatus?: string;
}

/** 数据源一节的输入：内置来源开关 + 来源列表 + 管理动作 + WebCal 刷新间隔。 */
export interface SettingsDataSourcesProps {
  /** 被隐藏的内置来源 id（SC-018）：缺省即显示。 */
  hiddenBuiltinSourceIds: readonly BuiltinSourceId[];
  onToggleBuiltinSource: (id: BuiltinSourceId, enabled: boolean) => void;
  /** 已导入 / 已订阅的来源。 */
  sources: readonly CalendarSource[];
  /** 正在刷新的来源 id（含后台刷新）。 */
  refreshingSourceIds: readonly string[];
  onRefreshSource: (sourceId: string) => void;
  /** 删除来源及其事件（App 负责确认后的级联删除）。 */
  onRemoveSource: (sourceId: string) => void;
  /** WebCal 常规刷新间隔（分钟）。 */
  webcalIntervalMinutes: number;
  onChangeWebcalInterval: (minutes: number) => void;
  /** 来源管理动作的结果说明（添加 / 刷新 / 删除共用一条）。 */
  sourceStatus?: string;
}

export function SettingsView({
  onClose,
  theme,
  onChangeTheme,
  dataSources,
  dataLayerHint,
  storeProblem,
  followableTeams,
  followedTeamIds,
  onToggleFollowedTeam,
  notifications,
  closeBehavior,
  onChangeCloseBehavior,
  closeBehaviorStatus,
}: SettingsViewProps) {
  const {
    hiddenBuiltinSourceIds,
    onToggleBuiltinSource,
    sources,
    refreshingSourceIds,
    onRefreshSource,
    onRemoveSource,
    webcalIntervalMinutes,
    onChangeWebcalInterval,
    sourceStatus,
  } = dataSources;

  function handleRemove(source: CalendarSource) {
    // 破坏性动作先确认：删除会级联删掉该来源的事件（SRC-002）。
    if (window.confirm(describeSourceRemoval(source))) {
      onRemoveSource(source.id);
    }
  }

  return (
    <section id="settings-view" className="settings-view" aria-label="设置">
      <header className="settings-header">
        <div className="settings-heading">
          <h2 className="settings-title">设置</h2>
          {dataLayerHint && (
            <p className="store-status" role="status">
              {dataLayerHint}
            </p>
          )}
          {/* 落盘失败与数据层状态并列：设置页是大部分写操作的入口，
              “改了但没写进磁盘”必须在这里也能看到（SC-019）。 */}
          {storeProblem && (
            <p className="store-status" role="status">
              {storeProblem}
            </p>
          )}
        </div>
        <button type="button" className="today-button" onClick={onClose}>
          返回月视图
        </button>
      </header>

      <div className="settings-body">
        {/* 外观（THEME-001–003）：即时生效，落盘键 app.theme。 */}
        <section className="settings-section" aria-labelledby="settings-theme">
          <h3 id="settings-theme" className="sidebar-heading">
            外观
          </h3>
          <div className="segmented" role="group" aria-label="主题">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="segmented-item"
                aria-pressed={theme === option.value}
                title={option.hint}
                onClick={() => onChangeTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="store-status">切换后立即生效（THEME-002）</p>
        </section>

        {/* 区域（SC-018 预留）：只陈述当前固定取值，不写入设置键。 */}
        <section className="settings-section" aria-labelledby="settings-region">
          <h3 id="settings-region" className="sidebar-heading">
            区域
          </h3>
          <dl className="region-facts">
            {REGION_FACTS.map((fact) => (
              <div key={fact.label} className="region-fact">
                <dt className="region-fact-label">{fact.label}</dt>
                <dd className="region-fact-value">
                  {fact.value}
                  <span className="region-fact-detail">{fact.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="store-status">{REGION_RESERVED_NOTE}</p>
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-sources"
        >
          <h3 id="settings-sources" className="sidebar-heading">
            数据源
          </h3>

          <h4 className="settings-subheading">内置来源</h4>
          <ul className="builtin-source-list">
            {BUILTIN_SOURCES.map((source) => (
              <li key={source.id}>
                <label className="builtin-source">
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
                  <span className="builtin-source-body">
                    <span className="source-name">{source.name}</span>
                    <span className="builtin-source-description">
                      {source.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <h4 className="settings-subheading">订阅与导入</h4>
          {sources.length === 0 ? (
            <p className="store-status">
              还没有导入或订阅的来源：在侧栏用「导入 ICS 文件…」或「订阅 ICS /
              WebCal 地址…」添加。
            </p>
          ) : (
            <ul className="settings-source-list">
              {sources.map((source) => {
                const refreshing = refreshingSourceIds.includes(source.id);
                return (
                  <li
                    key={source.id}
                    className="settings-source-item"
                    data-source-type={source.type}
                  >
                    <span
                      className="source-dot"
                      style={{ background: sourceColor(source.id) }}
                      aria-hidden="true"
                    />
                    <div className="source-body">
                      <span className="source-name">{source.name}</span>
                      <span className="source-status" role="status">
                        {sourceStatusText(source, refreshing)}
                      </span>
                    </div>
                    <span className="source-actions">
                      {source.type === WEBCAL_SOURCE_TYPE && (
                        <button
                          type="button"
                          className="source-action"
                          onClick={() => onRefreshSource(source.id)}
                          disabled={refreshing}
                        >
                          刷新
                        </button>
                      )}
                      <button
                        type="button"
                        className="source-action is-danger"
                        onClick={() => handleRemove(source)}
                      >
                        删除
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {sourceStatus && (
            <p className="store-status" role="status">
              {sourceStatus}
            </p>
          )}

          {/* WebCal 刷新（§12）：改完立即按新间隔重排，不需要重启。 */}
          <h4 className="settings-subheading">WebCal 刷新</h4>
          <label className="notification-field">
            <span className="notification-field-label">刷新间隔</span>
            <select
              className="notification-select"
              aria-label="WebCal 刷新间隔"
              value={String(webcalIntervalMinutes)}
              onChange={(event) =>
                onChangeWebcalInterval(Number(event.target.value))
              }
            >
              {WEBCAL_INTERVAL_OPTIONS.map((option) => (
                <option key={option.minutes} value={String(option.minutes)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="store-status">
            {describeWebcalRefreshPolicy(webcalIntervalMinutes)}
          </p>
        </section>

        {/* 关注球队（SC-016 / SPORT-006）：侧栏常驻条目之外的集中入口，
            同一组件、同一份状态，两处不会各自记一份关注列表。 */}
        <section
          className="settings-section"
          aria-labelledby="settings-followed-teams"
        >
          <h3 id="settings-followed-teams" className="sidebar-heading">
            关注球队
          </h3>
          <FollowedTeamsPicker
            teams={followableTeams}
            followedIds={followedTeamIds}
            onToggleTeam={onToggleFollowedTeam}
          />
        </section>

        {/* 通知（SC-017 / NOTIFY-001–003）：开关 + 比赛提醒提前量 + 权限状态。
            状态行必须能解释“为什么没提醒”（§13），因此读的是调度链路的
            同一份权限状态，而不是另写一句乐观文案。 */}
        <section
          className="settings-section"
          aria-labelledby="settings-notifications"
        >
          <h3 id="settings-notifications" className="sidebar-heading">
            通知
          </h3>
          <label className="notification-toggle">
            <input
              type="checkbox"
              checked={notifications.enabled}
              onChange={(event) =>
                notifications.onToggleEnabled(event.target.checked)
              }
            />
            日历提醒
          </label>
          <label className="notification-field">
            <span className="notification-field-label">比赛提醒</span>
            <select
              className="notification-select"
              aria-label="比赛提醒提前量"
              value={matchReminderOptionValue(notifications.matchReminder)}
              onChange={(event) =>
                notifications.onChangeMatchReminder(
                  matchReminderSettingFromOption(event.target.value),
                )
              }
            >
              {matchReminderOptionsFor(
                notifications.matchReminder,
                notifications.matchReminderDefaultLabel,
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p
            className="store-status"
            role="status"
            data-notification-permission={notifications.permission}
          >
            {notifications.status}
          </p>
          {notifications.canRequestPermission && (
            <button
              type="button"
              className="notification-permission-request"
              onClick={notifications.onRequestPermission}
            >
              请求系统授权
            </button>
          )}
        </section>

        {/* 窗口行为（SC-002）：两种语义互斥，用分段控件明确表达当前选择，
            文字同时说明“应用是否还在运行”，不靠颜色单独传达。 */}
        <section className="settings-section" aria-labelledby="settings-window">
          <h3 id="settings-window" className="sidebar-heading">
            关闭窗口时
          </h3>
          <div
            className="segmented"
            role="group"
            aria-labelledby="settings-window"
          >
            {CLOSE_BEHAVIOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="segmented-item"
                aria-pressed={closeBehavior === option.value}
                title={option.hint}
                onClick={() => onChangeCloseBehavior(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="store-status">{describeCloseBehavior(closeBehavior)}</p>
          {closeBehaviorStatus && (
            <p className="store-status" role="status">
              {closeBehaviorStatus}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
