import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayBackdrop } from "./DayBackdrop";
import type { DayBackdropSource } from "../semantic/day-backdrop";

afterEach(cleanup);

/**
 * SC-013：节日 / 节气专属背景（ui-design §9.1）。
 * 组件只做一件事：把逻辑引用解析成图片画在格子里；
 * 取不到资源或加载失败就是不画背景，不猜一个替代视觉。
 */

const MID_AUTUMN_REF = "bg.festival.mid-autumn-festival";

const ASSETS: DayBackdropSource = {
  urlFor: (ref) =>
    ref === MID_AUTUMN_REF ? "/assets/mid-autumn.webp" : undefined,
};

describe("节日 / 节气专属背景（SC-013 / ui-design §9.1）", () => {
  it("资源包给出地址时渲染背景图与文字遮罩，整层对读屏隐藏", () => {
    const { container } = render(
      <DayBackdrop ref={MID_AUTUMN_REF} assets={ASSETS} />,
    );
    const layer = container.querySelector(".cell-backdrop") as HTMLElement;

    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(
      layer.querySelector(".cell-backdrop-image")?.getAttribute("src"),
    ).toBe("/assets/mid-autumn.webp");
    // 遮罩与图片同层：文字对比度不依赖具体图片的明暗（§15.3）。
    expect(layer.querySelector(".cell-backdrop-scrim")).toBeTruthy();
  });

  it("默认资源包不含图片：不画背景，格子回到文字层", () => {
    const { container } = render(<DayBackdrop ref={MID_AUTUMN_REF} />);

    expect(container.querySelector(".cell-backdrop")).toBeNull();
  });

  it("资源包没有收录该引用时同样不画背景", () => {
    const { container } = render(
      <DayBackdrop ref="bg.solar-term.cold-dew" assets={ASSETS} />,
    );

    expect(container.querySelector(".cell-backdrop")).toBeNull();
  });

  it("资源包抛错按「没有资源」处理，异常不外泄到渲染层", () => {
    const broken: DayBackdropSource = {
      urlFor: () => {
        throw new Error("资源包损坏");
      },
    };
    const { container } = render(
      <DayBackdrop ref={MID_AUTUMN_REF} assets={broken} />,
    );

    expect(container.querySelector(".cell-backdrop")).toBeNull();
  });

  it("图片加载失败后退回「没有背景」，不留破图", () => {
    const { container } = render(
      <DayBackdrop ref={MID_AUTUMN_REF} assets={ASSETS} />,
    );
    fireEvent.error(screen.getByRole("presentation", { hidden: true }));

    expect(container.querySelector(".cell-backdrop")).toBeNull();
  });
});
