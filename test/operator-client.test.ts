import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  readRouterTelemetry,
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

  it("reads the router battery component for the configured booth", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          boothId: "booth-01",
          componentId: "router",
          displayName: "Travel router",
          latestSnapshot: {
            battery: {
              chargePercent: 78,
              temperatureCelsius: 31.5,
              voltageVolts: 3.88,
              currentAmperes: -0.42,
            },
          },
          capturedAt: "2026-08-20T14:59:59.000Z",
          receivedAt: "2026-08-20T15:00:00.000Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readRouterTelemetry("https://operator.example.com", "token", "booth-01"),
    ).resolves.toMatchObject({
      componentId: "router",
      latestSnapshot: {
        battery: {
          chargePercent: 78,
          temperatureCelsius: 31.5,
        },
      },
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      "https://operator.example.com/v1/system/components/current?boothId=booth-01&componentId=router",
    );
  });

  it("requests daily counters in the configured time zone and normalizes legacy fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        callsToday: 12,
        messagesToday: 8,
        callsTotal: 120,
        messagesTotal: 80,
        dayStartedAt: "2026-08-08T04:00:00.000Z",
        generatedAt: "2026-08-08T19:00:00.000Z",
        timeZone: "America/Toronto",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSummary("https://operator.example.com", "token", "America/Toronto"),
    ).resolves.toEqual({
      interactionsToday: 12,
      messagesToday: 8,
      interactionsTotal: 120,
      messagesTotal: 80,
      dayStartedAt: "2026-08-08T04:00:00.000Z",
      generatedAt: "2026-08-08T19:00:00.000Z",
      timeZone: "America/Toronto",
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      "https://operator.example.com/v1/monitor/summary?timeZone=America%2FToronto",
    );
  });

  it("prefers additive interaction fields and parses daily breakdowns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        response({
          interactionsToday: 14,
          callsToday: 12,
          messagesToday: 8,
          interactionsTotal: 144,
          callsTotal: 120,
          messagesTotal: 80,
          messagePlaybackStartsTotal: 0,
          breakdownToday: {
            noSelection: 3,
            wrongNumberAttempts: 5,
            messagesLeft: 4,
            messagePlaybackStarts: 7,
            instructionPlaybackStarts: 6,
          },
          dayStartedAt: "2026-08-08T04:00:00.000Z",
          generatedAt: "2026-08-08T19:00:00.000Z",
          timeZone: "America/Toronto",
        }),
      ),
    );

    await expect(
      readSummary("https://operator.example.com", "token", "America/Toronto"),
    ).resolves.toMatchObject({
      interactionsToday: 14,
      interactionsTotal: 144,
      messagePlaybackStartsTotal: 0,
      breakdownToday: {
        noSelection: 3,
        wrongNumberAttempts: 5,
        messagesLeft: 4,
        messagePlaybackStarts: 7,
        instructionPlaybackStarts: 6,
      },
    });
  });

  it("starts recovery polling without waiting for an initial API read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input) => {
        const url = input.toString();
        if (url.includes("/v1/status")) {
          return Promise.resolve(
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
          );
        }
        return Promise.resolve(
          url.includes("/v1/system/components/current") ? response([]) : response(null, 404),
        );
      }),
    );
    const monitor = {
      updateStatus: vi.fn(),
      updateSystem: vi.fn(),
      updateRouterTelemetry: vi.fn(),
      updateSummary: vi.fn(),
    };

    const feed = startOperatorPolling("https://operator.example.com", "token", "booth-01", monitor);
    await vi.waitFor(() => {
      expect(monitor.updateStatus).toHaveBeenCalledOnce();
    });
    feed.stop();
  });
});
