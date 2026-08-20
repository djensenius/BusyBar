import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BusyBarDeviceClient } from "../src/busy-client.js";
import type { MonitorConfig } from "../src/config.js";
import type { HomeAssistantSceneClient, SceneStatus } from "../src/home-assistant-client.js";
import {
  desiredDisplayBrightness,
  Monitor,
  nextBackPage,
  nextIdleMode,
  sceneActionForButton,
  sceneAnnouncementLabel,
  sceneIdForButton,
} from "../src/monitor.js";
import type {
  BoothStatus,
  BoothSystemSnapshotEnvelope,
  MonitorSummary,
  RouterTelemetryEnvelope,
} from "../src/schemas.js";
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
  startToggleLightIds: [],
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

const routerTelemetry = (): RouterTelemetryEnvelope => ({
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
  capturedAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
});

const summary = (): MonitorSummary => ({
  interactionsToday: 12,
  messagesToday: 8,
  interactionsTotal: 342,
  messagesTotal: 187,
  dayStartedAt: "2026-07-31T04:00:00.000Z",
  generatedAt: new Date().toISOString(),
  timeZone: "America/Toronto",
});

const summaryWithBreakdown = (): MonitorSummary => ({
  ...summary(),
  breakdownToday: {
    noSelection: 3,
    wrongNumberAttempts: 5,
    messagesLeft: 4,
    messagePlaybackStarts: 7,
    instructionPlaybackStarts: 6,
  },
});

const summaryWithAllTimeListen = (): MonitorSummary => ({
  ...summaryWithBreakdown(),
  messagePlaybackStartsTotal: 48,
});

const summaryWithZeroDailyCards = (): MonitorSummary => ({
  ...summary(),
  interactionsToday: 0,
  messagesToday: 0,
  messagePlaybackStartsTotal: 0,
  breakdownToday: {
    noSelection: 0,
    wrongNumberAttempts: 0,
    messagesLeft: 0,
    messagePlaybackStarts: 0,
    instructionPlaybackStarts: 0,
  },
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

const smartHomeStatus: SceneStatus = {
  matches: true,
  lights: [
    {
      entityId: "light.kitchen_island_lights",
      currentState: "on",
      currentBrightness: 45,
      sceneBrightness: 45,
      matches: true,
    },
  ],
};

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
      "PICKUP",
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
      "PICKUP",
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
      "PICKUP",
      "ALL",
      "342",
    ]);
    await monitor.stop();
  });

  it("rotates through fresh fan, Pi, and router battery vitals", async () => {
    const client = createClient();
    const monitor = new Monitor(
      { ...config, statusStaleAfterMs: 120_000, systemStaleAfterMs: 120_000 },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem({
      ...system(),
      snapshot: {
        temperatureCelsius: 48.5,
        fan: {
          commandedOn: true,
          pwmRatio: 0.4,
          coolingState: 2,
          maxCoolingState: 4,
        },
      },
    });
    monitor.updateRouterTelemetry(routerTelemetry());
    monitor.updateSummary(summary());
    await monitor.start();

    for (const expected of [
      ["PICKUP", "DAY", "12"],
      ["MSGS", "DAY", "8"],
      ["PICKUP", "ALL", "342"],
      ["MSGS", "ALL", "187"],
      ["FAN", "MEDIUM"],
      ["PI", "CPU TEMP", "49"],
      ["BATTERY", "ROUTER", "78%"],
      ["BAT TEMP", "ROUTER", "32"],
    ]) {
      await vi.advanceTimersByTimeAsync(
        expected[0] === "PICKUP" && expected[1] === "DAY"
          ? config.renderDebounceMs
          : config.frontRotationMs + config.renderDebounceMs,
      );
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(expected);
    }

    await monitor.stop();
  });

  it("rotates through daily breakout cards only when breakdowns are available", async () => {
    const client = createClient();
    const monitor = new Monitor(
      { ...config, statusStaleAfterMs: 120_000, systemStaleAfterMs: 120_000 },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summaryWithBreakdown());
    await monitor.start();

    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "DAY",
      "12",
    ]);
    for (const expected of [
      ["MSGS", "DAY", "8"],
      ["PICKUP", "ALL", "342"],
      ["MSGS", "ALL", "187"],
      ["NO SEL", "DAY", "3"],
      ["WRONG", "DAY", "5"],
      ["LEFT", "DAY", "4"],
      ["LISTEN", "DAY", "7"],
      ["INSTR", "DAY", "6"],
    ]) {
      await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(expected);
    }

    await monitor.stop();
  });

  it("keeps the old-server rotation order when listen-all is unavailable", async () => {
    const client = createClient();
    const monitor = new Monitor(
      { ...config, statusStaleAfterMs: 120_000, systemStaleAfterMs: 120_000 },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summaryWithBreakdown());
    await monitor.start();

    for (const expected of [
      ["PICKUP", "DAY", "12"],
      ["MSGS", "DAY", "8"],
      ["PICKUP", "ALL", "342"],
      ["MSGS", "ALL", "187"],
      ["NO SEL", "DAY", "3"],
      ["WRONG", "DAY", "5"],
      ["LEFT", "DAY", "4"],
      ["LISTEN", "DAY", "7"],
      ["INSTR", "DAY", "6"],
    ]) {
      await vi.advanceTimersByTimeAsync(
        expected[0] === "PICKUP" && expected[1] === "DAY"
          ? config.renderDebounceMs
          : config.frontRotationMs + config.renderDebounceMs,
      );
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(expected);
    }

    await monitor.stop();
  });

  it("adds listen-all for new servers and skips explicit zero daily cards", async () => {
    const client = createClient();
    const monitor = new Monitor(
      { ...config, statusStaleAfterMs: 120_000, systemStaleAfterMs: 120_000 },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summaryWithAllTimeListen());
    await monitor.start();

    for (const expected of [
      ["PICKUP", "DAY", "12"],
      ["MSGS", "DAY", "8"],
      ["PICKUP", "ALL", "342"],
      ["MSGS", "ALL", "187"],
      ["LISTEN", "ALL", "48"],
      ["NO SEL", "DAY", "3"],
      ["WRONG", "DAY", "5"],
      ["LEFT", "DAY", "4"],
      ["LISTEN", "DAY", "7"],
      ["INSTR", "DAY", "6"],
    ]) {
      await vi.advanceTimersByTimeAsync(
        expected[0] === "PICKUP" && expected[1] === "DAY"
          ? config.renderDebounceMs
          : config.frontRotationMs + config.renderDebounceMs,
      );
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(expected);
    }

    monitor.updateSummary(summaryWithZeroDailyCards());
    await vi.advanceTimersByTimeAsync(config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "ALL",
      "342",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "MSGS",
      "ALL",
      "187",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "LISTEN",
      "ALL",
      "0",
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
      "PICKUP",
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

  it("refreshes Comfy light levels for the rear smart-home page", async () => {
    const client = createClient();
    const homeAssistant: HomeAssistantSceneClient = {
      activateScene: vi.fn(() => Promise.resolve()),
      getSceneLightStatus: vi.fn(() => Promise.resolve(smartHomeStatus)),
      activateSceneOrTurnOffLights: vi.fn(() =>
        Promise.resolve({ result: "activated" as const, status: smartHomeStatus }),
      ),
    };
    const monitor = new Monitor(
      {
        ...config,
        homeAssistant: {
          url: "https://homeassistant.example.com",
          token: "ha-token",
        },
        startSceneId: "scene.comfy",
        startToggleLightIds: ["light.kitchen_island_lights"],
      },
      client,
      homeAssistant,
    );

    await monitor.start();
    expect(homeAssistant.getSceneLightStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(homeAssistant.getSceneLightStatus).toHaveBeenCalledTimes(2);

    await monitor.stop();
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

  it("cycles backward from the booth overview to the smart-home rear page", () => {
    expect(nextBackPage(0, -1)).toBe(3);
    expect(nextBackPage(3, -1)).toBe(2);
    expect(nextBackPage(3, 1)).toBe(0);
  });

  it("maps Start and dial press to configured Home Assistant scenes", () => {
    const smartHomeConfig = {
      ...config,
      startSceneId: "scene.comfy",
      startToggleLightIds: [
        "light.kitchen_island_lights",
        "light.kitchen_main_lights",
        "light.living_room_main_lights",
      ],
      dialSceneId: "scene.good_night",
    };
    expect(sceneIdForButton(smartHomeConfig, "START")).toBe("scene.comfy");
    expect(sceneIdForButton(smartHomeConfig, "OK")).toBe("scene.good_night");
    expect(sceneIdForButton(smartHomeConfig, "BACK")).toBeNull();
    expect(sceneActionForButton(smartHomeConfig, "START")).toEqual({
      sceneId: "scene.comfy",
      turnOffLightIds: [
        "light.kitchen_island_lights",
        "light.kitchen_main_lights",
        "light.living_room_main_lights",
      ],
    });
    expect(sceneActionForButton(smartHomeConfig, "OK")).toEqual({
      sceneId: "scene.good_night",
      turnOffLightIds: [],
    });
    expect(sceneAnnouncementLabel("scene.good_night")).toBe("GOOD NIGHT");
  });
});
