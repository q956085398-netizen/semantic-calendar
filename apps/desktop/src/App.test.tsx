import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
}));

describe("desktop IPC wiring", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("invokes greet and displays the backend message", async () => {
    invokeMock.mockResolvedValue(
      "你好，Semantic Calendar。Tauri IPC 工作正常。",
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "验证桌面 IPC" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Tauri IPC 工作正常",
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith("greet", {
      name: "Semantic Calendar",
    });
  });

  it("falls back to preview-mode hint when IPC is unavailable", async () => {
    invokeMock.mockRejectedValue(new Error("IPC 仅在桌面壳中可用"));

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "验证桌面 IPC" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "浏览器预览模式",
      ),
    );
  });
});
