import type { DisplayDrawParams } from "@busy-app/busy-lib";
import { describe, expect, it } from "vite-plus/test";
import type { MonitorConfig } from "../src/config.js";
import type { MonitorState } from "../src/renderer.js";
import { renderMonitor } from "../src/renderer.js";
import type { BoothStatus, BoothSystemSnapshotEnvelope, MonitorSummary } from "../src/schemas.js";

const now = Date.parse("2026-07-31T20:00:00.000Z");

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
  callsToday: 12,
  messagesToday: 8,
  dayStartedAt: "2026-07-31T04:00:00.000Z",
  generatedAt: new Date(now - 1_000).toISOString(),
  timeZone: "America/Toronto",
};

const model = (overrides: Partial<MonitorState> = {}): MonitorState => ({
  status: status("idle"),
  statusReceivedAtMs: now - 1_000,
  system,
  systemReceivedAtMs: now - 1_000,
  summary: null,
  frontFrame: "state",
  backPage: 0,
  cloudConnected: true,
  ...overrides,
});

const textsFor = (payload: DisplayDrawParams, display: "front" | "back"): string[] =>
  payload.elements.flatMap((element) =>
    element.display === display && "text" in element ? [element.text] : [],
  );

describe("monitor renderer", () => {
  it("rotates through ready, daily counters, and health", () => {
    expect(textsFor(renderMonitor(model(), config, now).payload, "front")).toEqual(["READY"]);
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "calls", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["CALLS 12"]);
    expect(
      textsFor(
        renderMonitor(model({ frontFrame: "messages", summary }), config, now).payload,
        "front",
      ),
    ).toEqual(["MSGS 8"]);
    expect(
      textsFor(renderMonitor(model({ frontFrame: "health" }), config, now).payload, "front"),
    ).toEqual(["SYSTEM OK"]);
  });

  it("uses a full-width gradient behind front text", () => {
    expect(renderMonitor(model(), config, now).payload.elements[0]).toMatchObject({
      type: "rectangle",
      display: "front",
      width: 72,
      height: 16,
      fill: "gradient_h",
    });
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
            frontFrame: "health",
            system: { ...system, receivedAt: "2020-01-01T00:00:00.000Z" },
            systemReceivedAtMs: now - 1_000,
          }),
          config,
          now,
        ).payload,
        "front",
      ),
    ).toEqual(["SYSTEM OK"]);
    expect(
      textsFor(
        renderMonitor(model({ statusReceivedAtMs: now - 80_000 }), config, now).payload,
        "front",
      ),
    ).toEqual(["OFFLINE"]);
  });
});
