import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { asNormalizedEvent, type EnrichedEvent } from "../data/model";
import { buildStoredEvents } from "../bench/fixtures";
import { expandEventOccurrences } from "../normalize/occurrences";
import { bucketEventsByDateKey } from "./event-buckets";
import { buildMonthGrid } from "./month-grid";
import {
  useMonthOccurrences,
  type MonthOccurrencesOptions,
} from "./use-month-occurrences";

afterEach(cleanup);

/**
 * 月视图读取路径的 React 接线（SC-020）。
 *
 * 这里断言的是“界面拿到的月格数据”这一层：什么时候是完整的、什么时候
 * 明确处于整理中、换窗口后旧任务的结果有没有漏进来。分片本身的口径
 * （预算、粒度、与同步路径逐条相同）在 month-occurrences.test.ts 里测。
 */

const OCTOBER = buildMonthGrid({ year: 2026, month: 10, today: "2026-10-01" });
const NOVEMBER = buildMonthGrid({ year: 2026, month: 11, today: "2026-10-01" });

function makeEvent(partial: Partial<EnrichedEvent>): EnrichedEvent {
  return {
    uid: "event@example.com",
    sourceId: "local-ics:test",
    title: "测试事件",
    start: "2026-10-01T09:00:00",
    allDay: false,
    normalizedTitle: "测试事件",
    ...partial,
  };
}

/** 常见规模：一个重复 master + 一次改期 + 一个孤儿例外，落在 10 月。 */
function smallEvents(): EnrichedEvent[] {
  return [
    makeEvent({ uid: "plain", start: "2026-10-05T09:00:00" }),
    makeEvent({
      uid: "weekly",
      start: "2026-09-30T09:00:00",
      recurrence: { rrule: "FREQ=WEEKLY;COUNT=8", exdates: [] },
    }),
    makeEvent({
      uid: "weekly",
      start: "2026-10-14T15:00:00",
      occurrenceId: "2026-10-14T09:00:00",
    }),
    makeEvent({
      uid: "orphan",
      start: "2026-10-20T10:00:00",
      occurrenceId: "2026-10-20T10:00:00",
    }),
  ];
}

/** 大数据量：真实规模混合形态（含重复规则与例外），第一个任务算不完。 */
function bigEvents(): EnrichedEvent[] {
  return buildStoredEvents(3_000, "local-ics:perf").map(asNormalizedEvent);
}

/** 参考实现：改动前的同步读取路径。 */
function expectedBuckets(
  events: EnrichedEvent[],
  grid: ReturnType<typeof buildMonthGrid>,
): Map<string, EnrichedEvent[]> {
  const lastWeek = grid.weeks[grid.weeks.length - 1];
  return bucketEventsByDateKey(
    expandEventOccurrences(events, {
      from: grid.weeks[0][0].dateKey,
      to: lastWeek[lastWeek.length - 1].dateKey,
    }),
  );
}

function countOf(buckets: ReadonlyMap<string, EnrichedEvent[]>): number {
  let total = 0;
  for (const bucket of buckets.values()) {
    total += bucket.length;
  }
  return total;
}

function Harness({
  events,
  grid,
  deps,
}: {
  events: EnrichedEvent[];
  grid: ReturnType<typeof buildMonthGrid>;
  deps: MonthOccurrencesOptions;
}) {
  const { eventsByDate, pending } = useMonthOccurrences(events, grid, deps);
  return (
    <>
      <span data-testid="state">{pending ? "整理中" : "就绪"}</span>
      <span data-testid="keys">
        {[...eventsByDate.keys()].sort().join(",")}
      </span>
      <span data-testid="count">{String(countOf(eventsByDate))}</span>
    </>
  );
}

/** 带月份切换的宿主：模拟用户在整理未完成时切到下一个月。 */
function SwitchHarness({
  events,
  deps,
}: {
  events: EnrichedEvent[];
  deps: MonthOccurrencesOptions;
}) {
  const [grid, setGrid] = useState(OCTOBER);
  const { eventsByDate, pending } = useMonthOccurrences(events, grid, deps);
  return (
    <>
      <button type="button" onClick={() => setGrid(NOVEMBER)}>
        下一月
      </button>
      <span data-testid="state">{pending ? "整理中" : "就绪"}</span>
      <span data-testid="keys">
        {[...eventsByDate.keys()].sort().join(",")}
      </span>
      <span data-testid="count">{String(countOf(eventsByDate))}</span>
    </>
  );
}

describe("useMonthOccurrences — 读取路径接线（SC-020）", () => {
  it("常见规模首帧就是完整月格：不进入整理状态，也不让出主线程", () => {
    const events = smallEvents();
    const yieldToMain = vi.fn(() => Promise.resolve());

    render(<Harness events={events} grid={OCTOBER} deps={{ yieldToMain }} />);

    expect(screen.getByTestId("state").textContent).toBe("就绪");
    expect(screen.getByTestId("count").textContent).toBe(
      String(countOf(expectedBuckets(events, OCTOBER))),
    );
    expect(yieldToMain).not.toHaveBeenCalled();
  });

  it("大数据量先给出整理状态与空月格，让出主线程后补齐完整结果", async () => {
    const events = bigEvents();
    const yieldToMain = vi.fn(() => Promise.resolve());

    render(<Harness events={events} grid={OCTOBER} deps={{ yieldToMain }} />);

    expect(screen.getByTestId("state").textContent).toBe("整理中");
    // 整理期间不发布半份结果：月格是空的，而不是一个随后还会变的月。
    expect(screen.getByTestId("count").textContent).toBe("0");

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("就绪"),
    );
    expect(screen.getByTestId("count").textContent).toBe(
      String(countOf(expectedBuckets(events, OCTOBER))),
    );
    expect(yieldToMain.mock.calls.length).toBeGreaterThan(0);
  });

  it("整理未完成时切月：新窗口只拿到新窗口的结果（旧任务不漏进来）", async () => {
    const events = [
      // 只在 10 月出现的普通事件（不重复），11 月的月格不该看到它。
      makeEvent({ uid: "october-only", start: "2026-10-19T09:00:00" }),
      // 11 月的事件，切换后应当出现。
      makeEvent({ uid: "november", start: "2026-11-16T09:00:00" }),
      ...bigEvents(),
    ];
    const yieldToMain = vi.fn(() => Promise.resolve());

    render(<SwitchHarness events={events} deps={{ yieldToMain }} />);
    expect(screen.getByTestId("state").textContent).toBe("整理中");

    fireEvent.click(screen.getByRole("button", { name: "下一月" }));
    expect(screen.getByTestId("state").textContent).toBe("整理中");

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("就绪"),
    );
    const expected = expectedBuckets(events, NOVEMBER);
    expect(screen.getByTestId("keys").textContent).toBe(
      [...expected.keys()].sort().join(","),
    );
    expect(screen.getByTestId("count").textContent).toBe(
      String(countOf(expected)),
    );
    expect(screen.getByTestId("keys").textContent).not.toContain("2026-10-19");
  });

  it("同一份输入的重渲染不重算（主题、选中日期这类渲染不触发整理）", () => {
    const events = smallEvents();
    const now = vi.fn(() => performance.now());
    const deps = { now };

    const { rerender } = render(
      <Harness events={events} grid={OCTOBER} deps={deps} />,
    );
    const readsAfterMount = now.mock.calls.length;
    expect(readsAfterMount).toBeGreaterThan(0);

    // 注入对象每次都是新的，但它不该参与记忆化键。
    rerender(<Harness events={events} grid={OCTOBER} deps={{ now }} />);
    expect(now.mock.calls.length).toBe(readsAfterMount);
    expect(screen.getByTestId("count").textContent).toBe(
      String(countOf(expectedBuckets(events, OCTOBER))),
    );
  });

  it("事件换了（导入 / 刷新）就重算：月格跟着新数据走", async () => {
    const events = smallEvents();
    const deps = { yieldToMain: () => Promise.resolve() };
    const { rerender } = render(
      <Harness events={events} grid={OCTOBER} deps={deps} />,
    );
    const before = screen.getByTestId("count").textContent;

    const grown = [
      ...events,
      makeEvent({ uid: "added", start: "2026-10-07T08:00:00" }),
    ];
    rerender(<Harness events={grown} grid={OCTOBER} deps={deps} />);

    await waitFor(() =>
      expect(screen.getByTestId("count").textContent).not.toBe(before),
    );
    expect(screen.getByTestId("count").textContent).toBe(
      String(countOf(expectedBuckets(grown, OCTOBER))),
    );
  });
});
