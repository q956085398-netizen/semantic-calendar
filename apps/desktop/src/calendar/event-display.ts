import type { EnrichedEvent } from "../data/model";
import {
  displayMetadataOf,
  type FixtureDisplay,
} from "../semantic/metadata-resolver";

/**
 * 事件的时间前缀（月格摘要 / Inspector 共用）。
 * 全天事件返回空串（不显示时间）；UTC 事件换算为本地 HH:mm，
 * 浮动本地时间直接取存储的日期部分。
 */
export function eventTimeLabel(
  event: Pick<EnrichedEvent, "start" | "allDay">,
): string {
  if (event.allDay) {
    return "";
  }
  if (event.start.endsWith("Z")) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(event.start));
  }
  return event.start.slice(11, 16);
}

/** 一场比赛事件：事件本身 + 已收窄的对阵展示载荷。 */
export interface FixtureEvent {
  event: EnrichedEvent;
  fixture: FixtureDisplay;
}

export interface SplitEvents {
  /** 有完整对阵载荷的事件：月格渲染“队标 VS 队标”，Inspector 渲染比赛详情。 */
  fixtures: FixtureEvent[];
  /** 其余事件：按普通增强事件渲染（SEM-003）。 */
  ordinary: EnrichedEvent[];
}

/**
 * 按展示载荷切分当日 / 单格事件（SC-016 / SPORT-004）。
 *
 * 判定依据只有 `metadata.fixture` 是否存在——即 Resolver 是否给出了完整的
 * 对阵载荷（联赛 + 两侧球队）。识别结果（semantic.type）不足以渲染比赛：
 * 载荷缺失时月格只能显示标题，而“队标 VS 队标”少一侧就不成立，
 * 所以这类事件必须留在普通通道里（displayMetadataOf 已在读取边界收窄）。
 */
export function splitFixtureEvents(events: EnrichedEvent[]): SplitEvents {
  const fixtures: FixtureEvent[] = [];
  const ordinary: EnrichedEvent[] = [];
  for (const event of events) {
    const fixture = displayMetadataOf(event)?.fixture;
    if (fixture === undefined) {
      ordinary.push(event);
    } else {
      fixtures.push({ event, fixture });
    }
  }
  return { fixtures, ordinary };
}
