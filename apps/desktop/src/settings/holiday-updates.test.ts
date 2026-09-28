import { describe, expect, it } from "vitest";
import { chinaDayLabelsOf } from "../semantic/app-china-days";
import {
  addHolidayUpdate,
  holidayCalendarWithUpdates,
  readHolidayUpdates,
} from "./holiday-updates";

const update = {
  year: 2027,
  revision: 1,
  notice: "年度通知",
  publishedAt: "2026-11-01",
  sourceUrl: "https://example.com/notice",
  items: [
    {
      names: ["元旦"],
      rest: [{ from: "2027-01-01", to: "2027-01-03" }],
      makeup: ["2027-01-04"],
    },
  ],
};

describe("年度节假日数据更新", () => {
  it("有效文件立即生成休假与补班载荷，并保留已有年份", () => {
    const updates = addHolidayUpdate([], update);
    const calendar = holidayCalendarWithUpdates(updates);
    const labels = chinaDayLabelsOf(
      [
        { dateKey: "2027-01-02" },
        { dateKey: "2027-01-04" },
        { dateKey: "2026-10-01" },
      ],
      calendar,
    );
    expect(labels.get("2027-01-02")?.kind).toBe("rest");
    expect(labels.get("2027-01-04")?.kind).toBe("makeup");
    expect(labels.get("2026-10-01")?.kind).toBe("rest");
    expect(readHolidayUpdates(updates)).toEqual(updates);
  });
  it("冲突或畸形日期拒绝，已有更新不被改写", () => {
    const saved = addHolidayUpdate([], update);
    expect(() =>
      addHolidayUpdate(saved, {
        ...update,
        year: 2028,
        items: [
          {
            names: ["元旦"],
            rest: [{ from: "2028-01-03", to: "2028-01-01" }],
            makeup: [],
          },
        ],
      }),
    ).toThrow();
    expect(readHolidayUpdates([{}])).toEqual([]);
    expect(saved).toHaveLength(1);
  });
});
