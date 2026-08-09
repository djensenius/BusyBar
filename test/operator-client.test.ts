import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  readStatus,
  readSummary,
  readSystem,
  startOperatorPolling,
} from "../src/operator-client.js";

const response = (body: unknown, status = 200): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Operator REST client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns persisted status snapshots and ignores the synthetic empty state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: 42,
          repeatCount: 3,
          state: "idle",
          updatedAt: "2026-08-08T19:00:00.000Z",
          currentQuestionId: null,
          currentMessageId: null,
          lastError: null,
          runtimeMode: "real",
        }),
      )
      .mockResolvedValueOnce(
        response({
          state: "idle",
          updatedAt: "2026-08-08T19:00:00.000Z",
          currentQuestionId: null,
          currentMessageId: null,
          lastError: null,
          runtimeMode: "real",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readStatus("https://operator.example.com", "token")).resolves.toMatchObject({
      id: 42,
      repeatCount: 3,
    });
    await expect(readStatus("https://operator.example.com", "token")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: "Bearer token" },
    });
  });

  it("returns null when system telemetry is not available", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response(null, 404)));

    await expect(
      readSystem("https://operator.example.com", "token", "booth-01"),
    ).resolves.toBeNull();
  });

  it("requests daily counters in the configured time zone", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        callsToday: 12,
        messagesToday: 8,
        dayStartedAt: "2026-08-08T04:00:00.000Z",
        generatedAt: "2026-08-08T19:00:00.000Z",
        timeZone: "America/Toronto",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSummary("https://operator.example.com", "token", "America/Toronto"),
    ).resolves.toMatchObject({ callsToday: 12, messagesToday: 8 });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      "https://operator.example.com/v1/monitor/summary?timeZone=America%2FToronto",
    );
  });

  it("starts recovery polling without waiting for an initial API read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url = input.toString();
        return Promise.resolve(
          url.includes("/v1/status")
            ? response({
                id: 42,
                repeatCount: 3,
                state: "idle",
                updatedAt: "2026-08-08T19:00:00.000Z",
                currentQuestionId: null,
                currentMessageId: null,
                lastError: null,
                runtimeMode: "real",
              })
            : response(null, 404),
        );
      }),
    );
    const monitor = {
      updateStatus: vi.fn(),
      updateSystem: vi.fn(),
      updateSummary: vi.fn(),
    };

    const feed = startOperatorPolling("https://operator.example.com", "token", "booth-01", monitor);
    await vi.waitFor(() => {
      expect(monitor.updateStatus).toHaveBeenCalledOnce();
    });
    feed.stop();
  });
});
