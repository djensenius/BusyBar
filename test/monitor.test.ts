import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BusyBarDeviceClient } from "../src/busy-client.js";
import type { MonitorConfig } from "../src/config.js";
import {
  desiredDisplayBrightness,
  Monitor,
  nextIdleMode,
  sceneAnnouncementLabel,
  sceneIdForButton,
} from "../src/monitor.js";
import type { BoothStatus, BoothSystemSnapshotEnvelope, MonitorSummary } from "../src/schemas.js";
import type { WeatherSnapshot } from "../src/weather-client.js";

const config: Extract<MonitorConfig, { enabled: true }> = {
  enabled: true,
  token: "cloud-token",
  apiUrl: "https://api.busy.app",
  boothId: "booth-01",
  localUrl: null,
  localAccessKey: null,
  applicationName: "telephone-booth-monitor",
  displayPriority: 100,
  statusStaleAfterMs: 75_000,
  systemStaleAfterMs: 20_000,
  renderDebounceMs: 250,
  frontRotationMs: 8_000,
  summaryPollIntervalMs: 30_000,
  timeZone: "America/Toronto",
  clockEnabled: true,
  lateNightBrightness: 5,
  homeAssistant: null,
  startSceneId: null,
  dialSceneId: null,
  weather: null,
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
  callsTotal: 342,
  messagesTotal: 187,
  dayStartedAt: "2026-07-31T04:00:00.000Z",
  generatedAt: new Date().toISOString(),
  timeZone: "America/Toronto",
});

const createClient = (): BusyBarDeviceClient & {
  draw: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  setBrightness: ReturnType<typeof vi.fn>;
} => ({
  draw: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  setBrightness: vi.fn(() => Promise.resolve()),
  playStockSound: vi.fn(() => Promise.resolve()),
});

const weather = (sunState: WeatherSnapshot["sunState"]): WeatherSnapshot => ({
  condition: "clear-night",
  sunState,
  temperatureCelsius: 20,
  feelsLikeCelsius: 18,
  precipitationProbability: 10,
  precipitationKind: "rain",
  highCelsius: 24,
  lowCelsius: 16,
  humidityPercent: 60,
  observedAt: new Date().toISOString(),
});

const frontTexts = (payload: DisplayDrawParams): string[] =>
  payload.elements.flatMap((element) =>
    element.display === "front" && "text" in element && element.text.length > 0
      ? [element.text]
      : [],
  );

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
    monitor.updateSummary(summary());
    await monitor.start();
    monitor.updateStatus({ ...status("recording"), id: 2 });

    await vi.advanceTimersByTimeAsync(250);

    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "RECORDING",
    ]);
    monitor.updateStatus({ ...status("idle"), id: 3 });
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "CALLS",
      "DAY",
      "12",
    ]);
    await monitor.stop();
  });

  it("rotates through today and overall counters while idle", async () => {
    const client = createClient();
    const monitor = new Monitor(config, client);
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summary());
    await monitor.start();

    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "CALLS",
      "DAY",
      "12",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "MSGS",
      "DAY",
      "8",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "CALLS",
      "ALL",
      "342",
    ]);
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
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "OFFLINE",
    ]);

    monitor.updateStatus({ ...first, repeatCount: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "CALLS",
      "ALL",
      "--",
    ]);
    await monitor.stop();
  });

  it("does not leave timers running when display startup fails", async () => {
    const client = createClient();
    client.clear = vi.fn(() => Promise.reject(new Error("display unavailable")));
    const monitor = new Monitor(config, client);

    await expect(monitor.start()).rejects.toThrow("display unavailable");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses 5% hardware brightness from 23:00 until sunrise", async () => {
    expect(
      desiredDisplayBrightness(
        weather("below_horizon"),
        "America/Toronto",
        5,
        Date.parse("2026-08-09T03:05:00.000Z"),
      ),
    ).toBe(5);
    expect(
      desiredDisplayBrightness(
        weather("below_horizon"),
        "America/Toronto",
        5,
        Date.parse("2026-08-08T22:00:00.000Z"),
      ),
    ).toBe("auto");
    expect(
      desiredDisplayBrightness(
        weather("above_horizon"),
        "America/Toronto",
        5,
        Date.parse("2026-08-09T10:00:00.000Z"),
      ),
    ).toBe("auto");
  });

  it("cycles through idle modes in both dial directions", () => {
    expect(nextIdleMode("all", 1)).toBe("weather");
    expect(nextIdleMode("weather", 1)).toBe("clock");
    expect(nextIdleMode("weather", -1)).toBe("all");
  });

  it("maps Start and dial press to configured Home Assistant scenes", () => {
    const smartHomeConfig = {
      ...config,
      startSceneId: "scene.comfy",
      dialSceneId: "scene.good_night",
    };
    expect(sceneIdForButton(smartHomeConfig, "START")).toBe("scene.comfy");
    expect(sceneIdForButton(smartHomeConfig, "OK")).toBe("scene.good_night");
    expect(sceneIdForButton(smartHomeConfig, "BACK")).toBeNull();
    expect(sceneAnnouncementLabel("scene.good_night")).toBe("GOOD NIGHT");
  });
});
