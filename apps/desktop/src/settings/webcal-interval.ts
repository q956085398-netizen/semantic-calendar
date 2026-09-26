/**
 * WebCal 刷新间隔设置（SC-018 / app-spec §9 SETTINGS、§12 后台行为）。
 *
 * 这条设置描述用户对“多久检查一次订阅”的偏好；调度的形状（单个定时器、
 * 到期才唤醒、不轮询）仍由 `data/webcal/refresh-scheduler.ts` 决定，
 * 这里只提供取值域与读取边界。
 *
 * 只接受选项内的分钟数：快照里手写的其他值按默认处理，不四舍五入到最近的
 * 选项（P-03：不猜用户意图）。失败重试间隔固定 30 分钟，与这条设置无关
 * ——失败来源需要更快恢复，表述见 `describeWebcalRefreshPolicy`。
 */

import { WEBCAL_RETRY_INTERVAL_MS } from "../data/webcal/refresh-scheduler";

/** 持久化键名，与快照 settings 命名空间一致。 */
export const WEBCAL_INTERVAL_SETTING_KEY = "webcal.refreshIntervalMinutes";

export interface WebcalIntervalOption {
  minutes: number;
  label: string;
}

/** 可选项与顺序：设置页下拉框直接渲染这份列表，顺序即展示顺序。 */
export const WEBCAL_INTERVAL_OPTIONS: readonly WebcalIntervalOption[] = [
  { minutes: 60, label: "每小时" },
  { minutes: 180, label: "每 3 小时" },
  { minutes: 360, label: "每 6 小时" },
  { minutes: 720, label: "每 12 小时" },
  { minutes: 1440, label: "每天" },
];

/** 默认间隔与调度器基线一致（6 小时）。 */
export const DEFAULT_WEBCAL_INTERVAL_MINUTES = 360;

/** 设置值（磁盘 JSON）→ 间隔分钟数；不在选项内一律回落到默认。 */
export function normalizeWebcalIntervalMinutes(value: unknown): number {
  const option = WEBCAL_INTERVAL_OPTIONS.find(
    (candidate) => candidate.minutes === value,
  );
  return option?.minutes ?? DEFAULT_WEBCAL_INTERVAL_MINUTES;
}

/** 间隔分钟数 → 毫秒（调度器只认毫秒）。 */
export function webcalIntervalMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/**
 * 当前取值的完整口径说明：常规间隔 + 失败重试。
 * 两个数字都来自各自唯一的来源（设置选项 / 调度器常量），界面不再抄一份。
 */
export function describeWebcalRefreshPolicy(minutes: number): string {
  const option = WEBCAL_INTERVAL_OPTIONS.find(
    (candidate) => candidate.minutes === minutes,
  );
  const interval = option?.label ?? `每 ${minutes} 分钟`;
  const retryMinutes = WEBCAL_RETRY_INTERVAL_MS / (60 * 1000);
  return `${interval}自动检查订阅；刷新失败后 ${retryMinutes} 分钟重试一次`;
}
