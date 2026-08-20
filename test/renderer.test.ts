import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { describe, expect, it } from "vite-plus/test";
import type { MonitorConfig } from "../src/config.js";
import type { MonitorState } from "../src/renderer.js";
import { availableFrontFrames, renderMonitor } from "../src/renderer.js";
import type { BoothStatus, BoothSystemSnapshotEnvelope, MonitorSummary } from "../src/schemas.js";
import { WeatherConditionSchema } from "../src/weather-client.js";
import type { WeatherSnapshot } from "../src/weather-client.js";

const now = Date.parse("2026-07-31T20:00:00.000Z");

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

const weatherEnabledConfig: Extract<MonitorConfig, { enabled: true }> = {
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
};

const smartHomeConfig: Extract<MonitorConfig, { enabled: true }> = {
  ...config,
  homeAssistant: {
    url: "https://homeassistant.example.com",
    token: "ha-token",
  },
  startSceneId: "scene.comfy",
  startToggleLightIds: [
    "light.kitchen_island_lights",
    "light.kitchen_main_lights",
    "light.living_room_main_lights",
  ],
  dialSceneId: "scene.good_night",
};

const status = (state: BoothStatus["state"]): BoothStatus => ({
  state,
  updatedAt: new Date(now - 1_000).toISOString(),
  currentQuestionId: null,
  currentMessageId: null,
  lastError: null,
  runtimeMode: "real",
});

const system: BoothSystemSnapshotEnvelope = {
  boothId: "booth-01",
  snapshot: {
    temperatureCelsius: 45,
    cpu: { usageRatio: 0.2, loadAvg1m: 0.4, physicalCores: 4 },
    memory: { usedBytes: 500, totalBytes: 1_000 },
    tailscale: { connected: true, peerCount: 2, hostname: "booth" },
  },
  receivedAt: new Date(now - 1_000).toISOString(),
  version: "0.3.2",
};

const summary: MonitorSummary = {
  interactionsToday: 12,
  messagesToday: 8,
  interactionsTotal: 342,
  messagesTotal: 187,
  dayStartedAt: "2026-07-31T04:00:00.000Z",
  generatedAt: new Date(now - 1_000).toISOString(),
  timeZone: "America/Toronto",
};

const breakdownSummary: MonitorSummary = {
  ...summary,
  breakdownToday: {
    noSelection: 3,
    wrongNumberAttempts: 5,
    messagesLeft: 4,
    messagePlaybackStarts: 7,
    instructionPlaybackStarts: 6,
  },
};

const weather: WeatherSnapshot = {
  condition: "rainy",
  sunState: "above_horizon",
  temperatureCelsius: 6,
  feelsLikeCelsius: 4,
  precipitationProbability: 70,
  precipitationKind: "rain",
  highCelsius: 8,
  lowCelsius: 1,
  humidityPercent: 82,
  observedAt: new Date(now - 1_000).toISOString(),
};

const model = (overrides: Partial<MonitorState> = {}): MonitorState => ({
  status: status("idle"),
  statusReceivedAtMs: now - 1_000,
  system,
  systemReceivedAtMs: now - 1_000,
  summary: null,
  weather: null,
  weatherReceivedAtMs: null,
  frontFrame: "interactionsToday",
  idleMode: "all",
  idleModeAnnouncement: null,
  sceneAnnouncement: null,
  smartHomeStatus: null,
  smartHomeAction: null,
  backPage: 0,
  cloudConnected: true,
  ...overrides,
});

const textsFor = (payload: DisplayDrawParams, display: "front" | "back"): string[] =>
  payload.elements.flatMap((element) =>
    element.display === display && "text" in element && element.text.length > 0
      ? [element.text]
      : [],
  );

const frontElementIds = (payload: DisplayDrawParams): string[] =>
  payload.elements
    .filter((element) => element.display === "front")
    .map((element) => element.id);

const frontFillColors = (payload: DisplayDrawParams): string[] =>
  payload.elements.flatMap((element) =>
    element.display === "front" && element.type === "rectangle"
      ? element.fill_colors
      : [],
  );

describe("monitor renderer", () => {
  it("renders pickup and message counters while healthy and idle", () => {
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "interactionsToday", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["PICK", "DAY", "12"]);
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "messagesToday", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["MSGS", "DAY", "8"]);
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "interactionsTotal", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["PICK", "ALL", "342"]);
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "messagesTotal", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["MSGS", "ALL", "187"]);
    expect(textsFor(renderMonitor(model(), config, now).payload, "front")).toEqual([
      "PICK",
      "DAY",
      "--",
    ]);
  });

  it("renders daily pickup breakout cards when the server provides them", () => {
    expect(
      textsFor(
        renderMonitor(
          model({ frontFrame: "noSelectionToday", summary: breakdownSummary }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["NO SEL", "DAY", "3"]);
    expect(
      textsFor(
        renderMonitor(
          model({ frontFrame: "wrongNumberAttemptsToday", summary: breakdownSummary }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["WRONG", "DAY", "5"]);
    expect(
      textsFor(
        renderMonitor(
          model({ frontFrame: "messagesLeftToday", summary: breakdownSummary }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["LEFT", "DAY", "4"]);
    expect(
      textsFor(
        renderMonitor(
          model({ frontFrame: "messagePlaybackStartsToday", summary: breakdownSummary }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["LISTEN", "DAY", "7"]);
    expect(
      textsFor(
        renderMonitor(
          model({ frontFrame: "instructionPlaybackStartsToday", summary: breakdownSummary }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["INSTR", "DAY", "6"]);
  });

  it("renders a 24-hour clock", () => {
    expect(
      textsFor(renderMonitor(model({ frontFrame: "clock" }), config, now).payload, "front"),
    ).toEqual(["16:00", "FRI", "JUL 31"]);
  });

  it("filters carousel frames by the selected idle mode", () => {
    const state = model({
      weather,
      weatherReceivedAtMs: now - 1_000,
    });
    expect(
      availableFrontFrames({ ...state, idleMode: "weather" }, weatherEnabledConfig, now),
    ).toEqual(["weather"]);
    expect(
      availableFrontFrames({ ...state, idleMode: "clock" }, weatherEnabledConfig, now),
    ).toEqual(["clock"]);
    expect(
      availableFrontFrames(
        { ...state, idleMode: "weatherClock" },
        weatherEnabledConfig,
        now,
      ),
    ).toEqual(["weather", "clock"]);
    expect(
      availableFrontFrames(
        { ...state, idleMode: "telephone", summary },
        weatherEnabledConfig,
        now,
      ),
    ).toEqual([
      "interactionsToday",
      "messagesToday",
      "interactionsTotal",
      "messagesTotal",
    ]);
    expect(
      availableFrontFrames(
        { ...state, idleMode: "telephone", summary: breakdownSummary },
        weatherEnabledConfig,
        now,
      ),
    ).toEqual([
      "interactionsToday",
      "messagesToday",
      "interactionsTotal",
      "messagesTotal",
      "noSelectionToday",
      "wrongNumberAttemptsToday",
      "messagesLeftToday",
      "messagePlaybackStartsToday",
      "instructionPlaybackStartsToday",
    ]);
  });

  it("shows a temporary mode confirmation", () => {
    expect(
      textsFor(
        renderMonitor(
          model({ idleMode: "weatherClock", idleModeAnnouncement: "weatherClock" }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["MODE", "WX+CLOCK"]);
  });

  it("renders progressive smart-home scene confirmation frames", () => {
    const first = renderMonitor(
      model({ sceneAnnouncement: { label: "COMFY", phase: 0 } }),
      config,
      now,
    );
    const final = renderMonitor(
      model({ sceneAnnouncement: { label: "GOOD NIGHT", phase: 2 } }),
      config,
      now,
    );

    expect(textsFor(first.payload, "front")).toEqual(["SCENE", "COMFY"]);
    expect(textsFor(final.payload, "front")).toEqual(["SCENE", "GOOD NIGHT"]);
    expect(frontFillColors(first.payload)).not.toEqual(frontFillColors(final.payload));
  });

  it("shows live scene levels and mappings on the smart-home rear page", () => {
    const rendered = renderMonitor(
      model({
        backPage: 3,
        smartHomeStatus: {
          matches: true,
          lights: [
            {
              entityId: "light.kitchen_island_lights",
              currentState: "on",
              currentBrightness: 45,
              sceneBrightness: 45,
              matches: true,
            },
            {
              entityId: "light.kitchen_main_lights",
              currentState: "on",
              currentBrightness: 91,
              sceneBrightness: 91,
              matches: true,
            },
            {
              entityId: "light.living_room_main_lights",
              currentState: "on",
              currentBrightness: 63,
              sceneBrightness: 63,
              matches: true,
            },
          ],
        },
        smartHomeAction: {
          sceneId: "scene.comfy",
          result: "activated",
        },
      }),
      smartHomeConfig,
      now,
    );

    expect(textsFor(rendered.payload, "back")).toEqual([
      "SMART HOME",
      "START COMFY",
      "STATUS COMFY ACTIVE",
      "TARGET ISL18% KIT36% LIV25%",
      "NOW ISL18% KIT36% LIV25%",
      "DIAL GOOD NIGHT",
      "LAST COMFY ON",
    ]);
  });

  it("keeps a compact legacy overview when daily breakdowns are unavailable", () => {
    expect(
      textsFor(renderMonitor(model({ summary }), smartHomeConfig, now).payload, "back"),
    ).toEqual([
      "DAY PICKUPS 12 MSGS 8",
      "STATE idle",
      "AGE 1s",
      "VIEW ALL",
      "QUESTION --",
      "MESSAGE --",
      "ERROR CLEAR",
    ]);
  });

  it("shows a compact daily pickup breakout on the rear overview", () => {
    expect(
      textsFor(renderMonitor(model({ summary: breakdownSummary }), smartHomeConfig, now).payload, "back"),
    ).toEqual([
      "DAY PICKUPS 12 MSGS 8",
      "NO SEL 3 WRONG 5",
      "LEFT 4 LISTEN 7",
      "INSTR 6",
      "STATE idle AGE 1s",
      "QUESTION -- MESSAGE --",
      "ERROR CLEAR VIEW ALL",
    ]);
  });

  it("renders smart weather details and every Home Assistant condition", () => {
    expect(
      textsFor(
        renderMonitor(
          model({
            frontFrame: "weather",
            weather,
            weatherReceivedAtMs: now - 1_000,
          }),
          weatherEnabledConfig,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["6", "RAIN", "70%"]);
    expect(
      textsFor(
        renderMonitor(
          model({
            frontFrame: "weather",
            weather: {
              ...weather,
              feelsLikeCelsius: 11,
              precipitationProbability: 20,
            },
            weatherReceivedAtMs: now - 1_000,
          }),
          weatherEnabledConfig,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["6", "FEELS", "11"]);
    expect(
      textsFor(
        renderMonitor(
          model({
            frontFrame: "weather",
            weather: {
              ...weather,
              feelsLikeCelsius: 7,
              precipitationProbability: 20,
            },
            weatherReceivedAtMs: now - 1_000,
          }),
          weatherEnabledConfig,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["6", "H", "8", "L", "1"]);
    expect(
      textsFor(
        renderMonitor(
          model({
            frontFrame: "weather",
            weather,
            weatherReceivedAtMs: now - 3_600_001,
          }),
          weatherEnabledConfig,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["PICK", "DAY", "--"]);

    for (const condition of WeatherConditionSchema.options) {
      const rendered = renderMonitor(
        model({
          frontFrame: "weather",
          weather: { ...weather, condition },
          weatherReceivedAtMs: now - 1_000,
        }),
        weatherEnabledConfig,
        now,
      );
      expect(textsFor(rendered.payload, "front")).toHaveLength(3);
    }
  });

  it("reuses a fixed set of front element IDs between carousel frames", () => {
    const calls = renderMonitor(
      model({ frontFrame: "interactionsToday", summary }),
      config,
      now,
    ).payload;
    const clock = renderMonitor(model({ frontFrame: "clock" }), config, now).payload;
    const rainy = renderMonitor(
      model({
        frontFrame: "weather",
        weather,
        weatherReceivedAtMs: now - 1_000,
      }),
      weatherEnabledConfig,
      now,
    ).payload;

    expect(frontElementIds(clock)).toEqual(frontElementIds(calls));
    expect(frontElementIds(rainy)).toEqual(frontElementIds(calls));
    expect(new Set(frontElementIds(calls)).size).toBe(frontElementIds(calls).length);
  });

  it("uses a full-width gradient behind front text", () => {
    const rendered = renderMonitor(model(), config, now);
    expect(rendered.payload.elements[0]).toMatchObject({
      type: "rectangle",
      display: "front",
      width: 72,
      height: 16,
      fill: "gradient_h",
    });
    expect(textsFor(rendered.payload, "back")).toContain("DAY PICKUPS -- MSGS --");
  });

  it("dims idle cards after sunset", () => {
    const daytime = renderMonitor(
      model({ summary, weather, weatherReceivedAtMs: now - 1_000 }),
      weatherEnabledConfig,
      now,
    ).payload;
    const nighttime = renderMonitor(
      model({
        summary,
        weather: { ...weather, sunState: "below_horizon" },
        weatherReceivedAtMs: now - 1_000,
      }),
      weatherEnabledConfig,
      now,
    ).payload;

    expect(frontFillColors(daytime).slice(0, 2)).toEqual(["#003B7AFF", "#006A85FF"]);
    expect(frontFillColors(nighttime).slice(0, 2)).toEqual(["#000000FF", "#000000FF"]);
  });

  it("pins active and critical states", () => {
    expect(
      textsFor(renderMonitor(model({ status: status("recording") }), config, now).payload, "front"),
    ).toEqual(["RECORDING"]);
    expect(
      textsFor(
        renderMonitor(
          model({
            system: {
              ...system,
              snapshot: { ...system.snapshot, temperatureCelsius: 80 },
            },
          }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["HOT"]);
  });

  it("uses local receipt times for stale detection", () => {
    expect(
      textsFor(
        renderMonitor(
          model({
            summary,
            system: { ...system, receivedAt: "2020-01-01T00:00:00.000Z" },
            systemReceivedAtMs: now - 1_000,
          }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["PICK", "DAY", "12"]);
    expect(
      textsFor(
        renderMonitor(model({ statusReceivedAtMs: now - 80_000 }), config, now).payload,
        "front",
      ),
    ).toEqual(["OFFLINE"]);
  });
});
