import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { BusyBarDeviceClient } from "../src/busy-client.js";
import type { MonitorConfig } from "../src/config.js";
import type { FluxHausSnapshot } from "../src/fluxhaus-client.js";
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
  fluxHaus: null,
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
  installationState: "active",
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

const fluxHausSnapshot = (
  active: Partial<Record<"washer" | "dryer", boolean>>,
): FluxHausSnapshot => ({
  generatedAt: new Date().toISOString(),
  devices: [
    {
      id: "washer",
      name: "Washer",
      active: active.washer ?? false,
      lifecycle: active.washer ? "active" : "finished",
      status: active.washer ? "Running" : "End programmed",
      detail: "Rinse",
      progressPercent: active.washer ? 62 : 100,
      remainingSeconds: active.washer ? 38 * 60 : 0,
      batteryPercent: null,
      updatedAt: null,
    },
    {
      id: "dryer",
      name: "Dryer",
      active: active.dryer ?? false,
      lifecycle: active.dryer ? "active" : "finished",
      status: active.dryer ? "Running" : "End programmed",
      detail: "Cottons",
      progressPercent: active.dryer ? 40 : 100,
      remainingSeconds: active.dryer ? 44 * 60 : 0,
      batteryPercent: null,
      updatedAt: null,
    },
  ],
  car: null,
});

const createClient = (): BusyBarDeviceClient & {
  draw: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  setBrightness: ReturnType<typeof vi.fn>;
  playStockSound: ReturnType<typeof vi.fn>;
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

  it("accepts synthetic downtime after a newer heartbeat and resumes on explicit start", async () => {
    const client = createClient();
    const monitor = new Monitor({
      ...config, clockEnabled: false, frontRotationMs: 60_000, audioEnabled: true, alertSound: "alarm",
    }, client);
    monitor.updateStatus(status("recording"));
    const delayed = { ...status("recording"), id: 2, installationState: "active" as const };
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(1_000);
    const inactive: BoothStatus = {
      state: "idle",
      updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true,
      installationState: "between_exhibitions",
    };
    monitor.updateStatus(inactive);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "BETWEEN",
    ]);
    expect(client.playStockSound).not.toHaveBeenCalled();
    monitor.updateStatus(
      delayed,
      Date.now(),
      "stream",
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "BETWEEN",
    ]);
    expect(client.playStockSound).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    monitor.updateStatus(inactive);
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();

    monitor.updateStatus({ ...inactive, installationState: "active" });
    monitor.updateSystem(system());
    monitor.updateStatus(delayed, Date.now(), "stream");
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "RECORDING",
    );
    monitor.updateStatus({ ...status("recording"), id: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "RECORDING",
    ]);
    monitor.updateStatus(inactive, Date.now(), "stream");
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "RECORDING",
    ]);
    await monitor.stop();
  });

  it("retains fresh runtime faults across synthetic polls without refreshing their age", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 600_000 }, client);
    monitor.updateStatus(status("error"));
    monitor.updateSystem(system());
    await monitor.start();
    const inactive: BoothStatus = {
      state: "idle",
      updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true,
      installationState: "between_exhibitions",
    };
    monitor.updateStatus(inactive);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("ERROR");
    await vi.advanceTimersByTimeAsync(20_000);
    monitor.updateStatus(inactive);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("ERROR");
    await vi.advanceTimersByTimeAsync(config.statusStaleAfterMs + 1);
    monitor.updateStatus(inactive);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(["BETWEEN"]);
    await monitor.stop();
  });

  it("does not mask API failures with expected downtime or another feed's recovery", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false }, client);
    monitor.updateStatus({
      state: "idle", updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true, installationState: "between_exhibitions",
    });
    await monitor.start();
    monitor.updateOperatorFeedHealth("system", false);
    monitor.updateOperatorFeedHealth("status", false);
    monitor.updateOperatorFeedHealth("system", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("API ERROR");
    monitor.updateOperatorFeedHealth("status", true);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(["BETWEEN"]);
    await monitor.stop();
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

  it("preserves a summary that arrives before the first active status poll", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 60_000 }, client);
    monitor.updateSummary({ ...summary(), installationState: "active" });
    await vi.advanceTimersByTimeAsync(1_000);
    monitor.updateStatus({ ...status("idle"), installationState: "active" });
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "12",
    ]);
    await monitor.stop();
  });

  it("clears an early summary when the first status poll reports downtime", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 60_000 }, client);
    monitor.updateSummary({ ...summary(), installationState: "active" });
    await vi.advanceTimersByTimeAsync(1_000);
    monitor.updateStatus({
      state: "idle", updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true, installationState: "between_exhibitions",
    });
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(["BETWEEN"]);
    monitor.updateStatus({ ...status("idle"), installationState: "active" });
    monitor.updateSystem(system());
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "--",
    ]);
    await monitor.stop();
  });

  it("accepts fresh summaries after downtime confirmation expires without masking offline status", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 60_000 }, client);
    monitor.updateStatus({
      state: "idle", updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true, installationState: "between_exhibitions",
    });
    await monitor.start();
    await vi.advanceTimersByTimeAsync(config.statusStaleAfterMs + 1);
    monitor.updateSummary({ ...summary(), interactionsToday: 3 });
    await vi.advanceTimersByTimeAsync(250);
    const payload = client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams;
    expect(frontTexts(payload)).toEqual(["OFFLINE"]);
    expect(payload.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ display: "back", text: "DAY PICKUPS 3 MSGS 8" }),
    ]));
    await monitor.stop();
  });

  it("invalidates cached totals when a newer summary reports downtime before status polling", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 60_000 }, client);
    monitor.updateStatus({ ...status("idle"), installationState: "active" });
    monitor.updateSystem(system());
    const previous = { ...summary(), installationState: "active" as const };
    monitor.updateSummary(previous);
    await monitor.start();
    await vi.advanceTimersByTimeAsync(1_000);
    const downtime = { ...summary(), installationState: "between_exhibitions" as const };
    monitor.updateSummary(downtime);
    monitor.updateSummary(previous);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "--",
    ]);
    monitor.updateSummary({
      ...summary(), installationState: "active", interactionsToday: 3, interactionsTotal: 3,
    });
    monitor.updateSummary(downtime);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "3",
    ]);
    await monitor.stop();
  });

  it("drops the previous exhibition's totals until a fresh post-start summary arrives", async () => {
    const client = createClient();
    const monitor = new Monitor({ ...config, clockEnabled: false, frontRotationMs: 60_000 }, client);
    monitor.updateStatus({ ...status("idle"), installationState: "active" });
    monitor.updateSystem(system());
    const previous = { ...summary(), installationState: "active" as const };
    monitor.updateSummary(previous);
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "12",
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    monitor.updateStatus({
      state: "idle", updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true, installationState: "between_exhibitions",
    });
    monitor.updateSummary(previous);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(["BETWEEN"]);

    await vi.advanceTimersByTimeAsync(1_000);
    monitor.updateStatus({ ...status("idle"), id: 2, installationState: "active" });
    monitor.updateSummary(previous);
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "--",
    ]);
    monitor.updateSummary({
      ...summary(), installationState: "active", interactionsToday: 3, interactionsTotal: 3,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP", "DAY", "3",
    ]);
    await monitor.stop();
  });

  it("keeps the clock carousel and appliance completions running during expected downtime", async () => {
    const client = createClient();
    const monitor = new Monitor({
      ...config,
      audioEnabled: true,
      alertSound: "notification",
      fluxHaus: {
        url: "https://haus.example.com",
        username: "demo",
        password: "secret",
        pollIntervalMs: 10_000,
        staleAfterMs: 120_000,
      },
    }, client);
    monitor.updateStatus({
      state: "idle", updatedAt: "1970-01-01T00:00:00.000Z",
      isSynthetic: true, installationState: "between_exhibitions",
    });
    await monitor.start();
    await vi.advanceTimersByTimeAsync(48_250);
    expect(client.draw.mock.calls.some(([payload]) =>
      !frontTexts(payload as DisplayDrawParams).includes("BETWEEN"),
    )).toBe(true);
    expect(client.playStockSound).not.toHaveBeenCalled();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER", "CYCLE", "DONE",
    ]);
    expect(client.playStockSound).toHaveBeenCalledOnce();
    await monitor.stop();
  });

  it("rotates from car to clock and weather during expected downtime", async () => {
    vi.setSystemTime(new Date("2026-07-31T20:00:00.000Z"));
    const client = createClient();
    const monitor = new Monitor({
      ...config,
      weather: {
        url: "https://homeassistant.example.com",
        token: "ha-token",
        entityId: "weather.patio",
        sunEntityId: "sun.sun",
        humidexEntityId: null,
        windChillEntityId: null,
        precipitationEntityId: null,
        pollIntervalMs: 600_000,
        staleAfterMs: 3_600_000,
        timeZone: "America/Toronto",
      },
      fluxHaus: {
        url: "https://haus.example.com",
        username: "demo",
        password: "secret",
        pollIntervalMs: 10_000,
        staleAfterMs: 120_000,
      },
    }, client);
    const now = Date.now();
    monitor.updateStatus({
      state: "idle",
      updatedAt: new Date(now).toISOString(),
      isSynthetic: true,
      installationState: "between_exhibitions",
    }, now);
    monitor.updateWeather(weather("above_horizon"), now);
    monitor.updateFluxHaus({
      ...fluxHausSnapshot({}),
      generatedAt: new Date(now).toISOString(),
      car: {
        batteryPercent: 78,
        evRangeKm: 356,
        totalRangeKm: 356,
        charging: false,
        updatedAt: new Date(now - 12 * 60_000).toISOString(),
      },
    }, now);

    await monitor.start();
    await vi.advanceTimersByTimeAsync(config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "RANGE", "356 KM", "78%",
    ]);

    await vi.advanceTimersByTimeAsync(config.frontRotationMs / 2 + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "UPDATED", "12M AGO", "78%",
    ]);

    await vi.advanceTimersByTimeAsync(config.frontRotationMs / 2 + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)[0]).toBe("16:00");

    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)[0]).toBe("20");

    await monitor.stop();
  });

  it("suppresses startup completions and alerts once when equipment finishes", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        frontRotationMs: 60_000,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summary());
    await monitor.start();

    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();

    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER",
      "CYCLE",
      "DONE",
    ]);
    expect(client.playStockSound).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "DAY",
      "12",
    ]);
    await monitor.stop();
  });

  it("queues simultaneous equipment completions in device order", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true, dryer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false, dryer: false }));

    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER",
      "CYCLE",
      "DONE",
    ]);

    await vi.advanceTimersByTimeAsync(10_250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "DRYER",
      "CYCLE",
      "DONE",
    ]);
    expect(client.playStockSound).toHaveBeenCalledTimes(2);
    await monitor.stop();
  });

  it("does not treat a paused device as completed", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    const paused = fluxHausSnapshot({ washer: false });
    paused.devices[0] = {
      ...paused.devices[0]!,
      lifecycle: "paused",
      status: "Pause",
    };
    monitor.updateFluxHaus(paused);

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "DONE",
    );
    await monitor.stop();
  });

  it("does not treat delayed or unknown device telemetry as completed", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    const delayed = fluxHausSnapshot({ washer: false });
    delayed.devices[0] = {
      ...delayed.devices[0]!,
      lifecycle: "unknown",
      status: "Waiting to start",
    };
    monitor.updateFluxHaus(delayed);

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "DONE",
    );
    await monitor.stop();
  });

  it("alerts when an active device reaches an inactive terminal state", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    const inactive = fluxHausSnapshot({ washer: false });
    inactive.devices[0] = {
      ...inactive.devices[0]!,
      lifecycle: "inactive",
      status: "Off",
    };
    monitor.updateFluxHaus(inactive);

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).toHaveBeenCalledOnce();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("DONE");
    await monitor.stop();
  });

  it("queues distinct completion cycles from the same device", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.playStockSound).toHaveBeenCalledTimes(2);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER",
      "CYCLE",
      "DONE",
    ]);

    await vi.advanceTimersByTimeAsync(10_250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "DONE",
    );
    await monitor.stop();
  });

  it("retains more than ten unexpired completion events", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        statusStaleAfterMs: 10 * 60_000,
        systemStaleAfterMs: 10 * 60_000,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("recording"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    for (let cycle = 0; cycle < 11; cycle += 1) {
      monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
      monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    }

    monitor.updateStatus({ ...status("idle"), id: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).toHaveBeenCalledTimes(1);
    for (let cycle = 1; cycle < 11; cycle += 1) {
      await vi.advanceTimersByTimeAsync(10_250);
      expect(client.playStockSound).toHaveBeenCalledTimes(cycle + 1);
    }
    await monitor.stop();
  });

  it("pauses carousel rotation while a completion is displayed", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        frontRotationMs: 1_000,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summary());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("DONE");

    await vi.advanceTimersByTimeAsync(10_250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "DAY",
      "12",
    ]);
    await monitor.stop();
  });

  it("starts completion audio and duration only after a successful draw", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    client.draw.mockRejectedValueOnce(new Error("display unavailable"));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_250);
    expect(client.playStockSound).toHaveBeenCalledOnce();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER",
      "CYCLE",
      "DONE",
    ]);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toContain("DONE");
    await vi.advanceTimersByTimeAsync(251);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "DONE",
    );
    await monitor.stop();
  });

  it("expires a completion that cannot be drawn", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        statusStaleAfterMs: 10 * 60_000,
        systemStaleAfterMs: 10 * 60_000,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    client.draw.mockRejectedValue(new Error("display unavailable"));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    client.draw.mockResolvedValue(undefined);
    monitor.updateSystem(system());
    monitor.updateStatus({ ...status("idle"), id: 2 });
    await vi.advanceTimersByTimeAsync(30_250);

    expect(client.playStockSound).not.toHaveBeenCalled();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).not.toContain(
      "DONE",
    );
    await monitor.stop();
  });

  it("does not confirm a completion draw after shutdown begins", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);

    let resolveDraw: (() => void) | undefined;
    client.draw.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDraw = resolve;
        }),
    );
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
    await vi.advanceTimersByTimeAsync(250);

    const stopping = monitor.stop();
    resolveDraw?.();
    await stopping;

    expect(client.playStockSound).not.toHaveBeenCalled();
  });

  it("retains completions until system telemetry is renderable", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    await monitor.start();
    await vi.advanceTimersByTimeAsync(250);
    client.playStockSound.mockClear();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "OFFLINE",
    ]);

    monitor.updateSystem(system());
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).toHaveBeenCalledOnce();
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "WASHER",
      "CYCLE",
      "DONE",
    ]);
    await monitor.stop();
  });

  it("expires deferred completions and resets stale FluxHaus baselines", async () => {
    const client = createClient();
    const fluxHausConfig = {
      url: "https://haus.example.com",
      username: "demo",
      password: "secret",
      pollIntervalMs: 10_000,
      staleAfterMs: 120_000,
    };
    const monitor = new Monitor(
      {
        ...config,
        statusStaleAfterMs: 10 * 60_000,
        systemStaleAfterMs: 10 * 60_000,
        audioEnabled: true,
        alertSound: "notification",
        fluxHaus: fluxHausConfig,
      },
      client,
    );
    monitor.updateStatus(status("recording"));
    monitor.updateSystem(system());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    monitor.updateSystem(system());
    monitor.updateStatus({ ...status("idle"), id: 2 });
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();

    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true }));
    await vi.advanceTimersByTimeAsync(fluxHausConfig.staleAfterMs + 1);
    monitor.updateSystem(system());
    monitor.updateStatus({ ...status("idle"), id: 3 });
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: false }));
    await vi.advanceTimersByTimeAsync(250);
    expect(client.playStockSound).not.toHaveBeenCalled();
    await monitor.stop();
  });

  it("rotates the complete active FluxHaus group after each normal card", async () => {
    const client = createClient();
    const monitor = new Monitor(
      {
        ...config,
        frontRotationMs: 1_000,
        fluxHaus: {
          url: "https://haus.example.com",
          username: "demo",
          password: "secret",
          pollIntervalMs: 10_000,
          staleAfterMs: 120_000,
        },
      },
      client,
    );
    monitor.updateStatus(status("idle"));
    monitor.updateSystem(system());
    monitor.updateSummary(summary());
    await monitor.start();
    monitor.updateFluxHaus(fluxHausSnapshot({ washer: true, dryer: true }));

    await vi.advanceTimersByTimeAsync(250);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "DAY",
      "12",
    ]);
    for (const expected of [
      ["WASHER", "RINSE", "38M"],
      ["DRYER", "COTTONS", "44M"],
      ["MSGS", "DAY", "8"],
      ["WASHER", "RINSE", "38M"],
      ["DRYER", "COTTONS", "44M"],
    ]) {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(
        expected,
      );
    }
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
      "EXH",
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
      ["PICKUP", "EXH", "342"],
      ["MSGS", "EXH", "187"],
      ["FAN", "MEDIUM"],
      ["PI", "CPU TEMP", "49"],
      ["BATTERY", "ROUTER", "78%"],
      ["BATTERY", "ROUTER", "32"],
    ]) {
      await vi.advanceTimersByTimeAsync(
        expected[0] === "PICKUP" && expected[1] === "DAY"
          ? config.renderDebounceMs
          : config.frontRotationMs + config.renderDebounceMs,
      );
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(
        expected,
      );
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
      ["PICKUP", "EXH", "342"],
      ["MSGS", "EXH", "187"],
      ["NO DIAL", "DAY", "3"],
      ["WRONG", "DAY", "5"],
      ["LEFT", "DAY", "4"],
      ["LISTEN", "DAY", "7"],
      ["INSTR", "DAY", "6"],
    ]) {
      await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(
        expected,
      );
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
      ["PICKUP", "EXH", "342"],
      ["MSGS", "EXH", "187"],
      ["NO DIAL", "DAY", "3"],
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
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(
        expected,
      );
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
      ["PICKUP", "EXH", "342"],
      ["MSGS", "EXH", "187"],
      ["LISTEN", "EXH", "48"],
      ["NO DIAL", "DAY", "3"],
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
      expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual(
        expected,
      );
    }

    monitor.updateSummary(summaryWithZeroDailyCards());
    await vi.advanceTimersByTimeAsync(config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "PICKUP",
      "EXH",
      "342",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "MSGS",
      "EXH",
      "187",
    ]);
    await vi.advanceTimersByTimeAsync(config.frontRotationMs + config.renderDebounceMs);
    expect(frontTexts(client.draw.mock.calls.at(-1)?.[0] as DisplayDrawParams)).toEqual([
      "LISTEN",
      "EXH",
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
