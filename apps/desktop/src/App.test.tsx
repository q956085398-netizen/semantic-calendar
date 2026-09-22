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

function asPromise(value: unknown): Promise<unknown> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

/** 按命令分发 IPC mock，未配置的命令默认成功返回 null。 */
function mockBackend(
  overrides: {
    greet?: string | Error;
    dataStoreRead?: string | null | Error;
  } = {},
) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "greet") {
      return asPromise(
        overrides.greet ?? "你好，Semantic Calendar。Tauri IPC 工作正常。",
      );
    }
    if (cmd === "data_store_read") {
      return asPromise(overrides.dataStoreRead ?? null);
    }
    return Promise.resolve(null);
  });
}

function writtenSnapshots(): Array<Record<string, unknown>> {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "data_store_write")
    .map(
      ([, args]) =>
        JSON.parse(String(args?.contents)) as Record<string, unknown>,
    );
}

describe("desktop IPC wiring", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockBackend();
  });

  afterEach(() => {
    cleanup();
  });

  it("invokes greet and displays the backend message", async () => {
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
    mockBackend({
      greet: new Error("IPC 仅在桌面壳中可用"),
      dataStoreRead: new Error("IPC 仅在桌面壳中可用"),
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "验证桌面 IPC" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "浏览器预览模式",
      ),
    );
  });
});

describe("本地数据层接线", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockBackend();
  });

  afterEach(() => {
    cleanup();
  });

  it("首次启动时创建快照并记录启动时间", async () => {
    mockBackend({ dataStoreRead: null });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/首次启动/)).toBeTruthy());
    expect(screen.getByText(/schema v1/)).toBeTruthy();

    const snapshots = writtenSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].schemaVersion).toBe(1);
    expect(
      (snapshots[0].settings as Record<string, unknown>)["app.lastOpenedAt"],
    ).toEqual(expect.any(String));
    expect(invokeMock).toHaveBeenCalledWith("data_store_read", {
      fileName: "calendar-store.json",
    });
  });

  it("再次启动时从持久化快照读回上次启动时间", async () => {
    mockBackend({
      dataStoreRead: JSON.stringify({
        schemaVersion: 1,
        sources: [],
        events: [],
        enrichments: {},
        settings: { "app.lastOpenedAt": "2026-09-22T10:00:00.000Z" },
      }),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/上次启动/)).toBeTruthy());
  });

  it("无 IPC 环境下降级为预览提示", async () => {
    mockBackend({
      dataStoreRead: new Error(
        "window.__TAURI_INTERNALS__ is undefined（浏览器预览）",
      ),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText(/仅桌面壳可用/)).toBeTruthy());
  });
});
