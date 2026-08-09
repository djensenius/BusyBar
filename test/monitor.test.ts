import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BusyBarDeviceClient } from "../src/busy-client.js";
import type { MonitorConfig } from "../src/config.js";
import { Monitor } from "../src/monitor.js";
import type { BoothStatus, BoothSystemSnapshotEnvelope, MonitorSummary } from "../src/schemas.js";

const config: Extract<MonitorConfig, { enabled: true }> = {
  enabled: true,
  token: "cloud-token",
  apiUrl: "https://api.busy.app",
  cloudWebSocketUrl: "wss://api.busy.app/api/v1/bars/ws",
  boothId: "booth-01",
  deviceId: null,
  applicationName: "telephone-booth-monitor",
  displayPriority: 100,
  statusStaleAfterMs: 75_000,
  systemStaleAfterMs: 20_000,
  renderDebounceMs: 250,
  frontRotationMs: 8_000,
  summaryPollIntervalMs: 30_000,
  timeZone: "America/Toronto",
  audioEnabled: false,
  alertSound: null,
  alertCooldownMs: 300_000,
  operatorApiUrl: "https://operator.example.com",
  operatorToken: "operator-token",
};

const status = (state: BoothStatus["state"]): BoothStatus => ({
  id: 1,
  repeatCount: 1,
  state,
  updatedAt: new Date().toISOString(),
  currentQuestionId: null,
  currentMessageId: null,
  lastError: null,
  runtimeMode: "real",
});

const system = (): BoothSystemSnapshotEnvelope => ({
  boothId: "booth-01",
  snapshot: { temperatureCelsius: 45 },
  receivedAt: new Date().toISOString(),
  version: "0.3.2",
});

const summary = (): MonitorSummary => ({
  callsToday: 12,
  messagesToday: 8,
  dayStartedAt: "2026-07-31T04:00:00.000Z",
  generatedAt: new Date().toISOString(),
  timeZone: "America/Toronto",
});

const createClient = (): BusyBarDeviceClient & {
  draw: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} => ({
  resolveDeviceId: vi.fn(() => Promise.resolve(null)),
  draw: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  playStockSound: vi.fn(() => Promise.resolve()),
});

const frontText = (payload: DisplayDrawParams): string | undefined => {
  const element = payload.elements.find(
    (candidate) => candidate.display === "front" && "text" in candidate,
  );
  return element && "text" in element ? element.text : undefined;
};

describe("monitor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the latest active state", async () => {
    const client = createClient();
    const monitor = new Monitor(config, client);
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateStatus({ ...status("recording"), id: 2 });

    await vi.advanceTimersByTimeAsync(250);

    expect(frontText(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toBe("RECORDING");
    await monitor.stop();
  });

  it("rotates through daily counters while idle", async () => {
    const client = createClient();
    const monitor = new Monitor(config, client);
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summary());
    await monitor.start();

    await vi.advanceTimersByTimeAsync(250);
    expect(frontText(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toBe("READY");
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontText(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toBe("CALLS 12");
    await monitor.stop();
  });

  it("refreshes freshness only when the heartbeat advances", async () => {
    const client = createClient();
    const monitor = new Monitor(
      { ...config, statusStaleAfterMs: 20_000, systemStaleAfterMs: 1_000_000 },
      client,
    );
    const first = status("idle");
    monitor.updateStatus(first);
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(15_000);

    monitor.updateStatus(first);
    await vi.advanceTimersByTimeAsync(5_250);
    expect(frontText(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toBe("OFFLINE");

    monitor.updateStatus({ ...first, repeatCount: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(frontText(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toBe("READY");
    await monitor.stop();
  });

  it("does not leave timers running when cloud discovery fails", async () => {
    const client = createClient();
    client.resolveDeviceId = vi.fn(() => Promise.reject(new Error("cloud unavailable")));
    const monitor = new Monitor(config, client);

    await expect(monitor.start()).rejects.toThrow("cloud unavailable");

    expect(vi.getTimerCount()).toBe(0);
  });
});
