import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invokeMock(command, args),
}));

import { createTauriHttpIO } from "./tauri-http-io";

describe("Tauri HttpIO request cancellation", () => {
  beforeEach(() => invokeMock.mockReset());

  it("registers each request and cancels only the matching native request", async () => {
    const pending = new Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >();
    const cancelled: string[] = [];
    const commands: Array<{
      command: string;
      requestId: string;
      stack?: string;
    }> = [];
    invokeMock.mockImplementation(
      (command: string, args: Record<string, unknown> = {}) => {
        if (typeof command !== "string") return Promise.resolve(null);
        const requestId = String(args.requestId);
        commands.push({ command, requestId });
        if (command === "webcal_request_begin") return Promise.resolve(null);
        if (command === "webcal_request_cancel") {
          cancelled.push(requestId);
          pending.get(requestId)?.reject(new Error("native request cancelled"));
          return Promise.resolve(null);
        }
        if (command === "webcal_fetch") {
          return new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
          });
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    );

    const http = createTauriHttpIO();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = http.get(
      { url: "https://one.example/calendar.ics" },
      firstController.signal,
    );
    const second = http.get(
      { url: "https://two.example/calendar.ics" },
      secondController.signal,
    );
    await vi.waitFor(() => expect(pending.size).toBe(2));

    const requestIds = [...pending.keys()];
    expect(commands.slice(0, 4).map(({ command }) => command)).toEqual([
      "webcal_request_begin",
      "webcal_request_begin",
      "webcal_fetch",
      "webcal_fetch",
    ]);

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toEqual([requestIds[0]]);

    pending.get(requestIds[1])!.resolve({
      status: 200,
      notModified: false,
      body: "BEGIN:VCALENDAR",
      etag: null,
      lastModified: null,
    });
    await expect(second).resolves.toMatchObject({
      status: 200,
      body: "BEGIN:VCALENDAR",
    });
    expect(commands.map(({ command }) => command)).toEqual([
      "webcal_request_begin",
      "webcal_request_begin",
      "webcal_fetch",
      "webcal_fetch",
      "webcal_request_cancel",
    ]);
  });
});
