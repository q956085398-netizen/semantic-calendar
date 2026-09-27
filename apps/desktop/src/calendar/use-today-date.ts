import { useCallback, useEffect, useState } from "react";
import { todayKeyFromDate } from "./month-grid";
import { nextLocalMidnightDelay } from "../scheduling/local-day";

/**
 * 当前本机日期：在下一个本地午夜更新，并在窗口重新获得焦点或回到前台时
 * 校准。没有常驻轮询；跨天刷新只安排一个定时器。
 */
export function useTodayDate(): [Date, () => Date] {
  const [today, setToday] = useState(() => new Date());
  const refreshToday = useCallback(() => {
    const now = new Date();
    const key = todayKeyFromDate(now);
    setToday((current) => (todayKeyFromDate(current) === key ? current : now));
    return now;
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const scheduleNextMidnight = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const now = Date.now();
      timer = window.setTimeout(
        () => {
          refreshToday();
          scheduleNextMidnight();
        },
        Math.max(1, nextLocalMidnightDelay(now)),
      );
    };
    const resync = () => {
      refreshToday();
      scheduleNextMidnight();
    };

    scheduleNextMidnight();
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [refreshToday]);

  return [today, refreshToday];
}
