import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FollowedTeamsPicker } from "./FollowedTeamsPicker";
import type { FixtureTeamDisplay } from "../semantic/metadata-resolver";

afterEach(cleanup);

/**
 * 关注球队选择器（SC-016 / SPORT-006、ui-design §4）。
 *
 * 组件只渲染注入的展示载荷与当前关注 id：不认识球队、不读写存储。
 * 持久化在 App 与本地数据层，这里只验证交互与状态回显。
 */

const TEAMS: FixtureTeamDisplay[] = [
  {
    id: "team-a",
    nameZh: "甲队",
    nameEn: "Team A",
    code: "TMA",
    crestRef: "crest.team.a",
    colors: { primary: "#123456", secondary: "#FFFFFF" },
  },
  {
    id: "team-b",
    nameZh: "乙队",
    nameEn: "Team B",
    code: "TMB",
    crestRef: "crest.team.b",
    colors: { primary: "#654321", secondary: "#FFFFFF" },
  },
];

function renderPicker(
  followedIds: readonly string[] = [],
  teams: FixtureTeamDisplay[] = TEAMS,
  onToggleTeam = vi.fn(),
) {
  render(
    <FollowedTeamsPicker
      teams={teams}
      followedIds={followedIds}
      onToggleTeam={onToggleTeam}
    />,
  );
  return onToggleTeam;
}

describe("关注球队选择器（SC-016）", () => {
  it("列出全部可关注球队，已关注项处于勾选状态", () => {
    renderPicker(["team-b"]);

    expect((screen.getByLabelText(/甲队/) as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByLabelText(/乙队/) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("勾选球队时回调目标状态（关注 / 取消关注）", () => {
    const onToggle = renderPicker(["team-a"]);
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];

    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith("team-a", false);

    fireEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenLastCalledWith("team-b", true);
  });

  it("摘要显示关注数量，未选择时不显示数量", () => {
    renderPicker([]);
    expect(screen.getByText("未选择")).toBeTruthy();
    cleanup();

    renderPicker(["team-a", "team-b"]);
    expect(screen.getByText("已关注 2 支")).toBeTruthy();
  });

  it("没有可关注球队时给出明确空状态", () => {
    renderPicker([], []);

    expect(screen.getByText("暂无可关注的球队")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
