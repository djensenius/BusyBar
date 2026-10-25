import { describe, expect, it } from "vite-plus/test";
import { aggregateSystemHealthSeverity } from "../src/health.js";
import type { BoothSystemSnapshot } from "../src/schemas.js";

describe("system health warning thresholds", () => {
  it.each<[string, BoothSystemSnapshot]>([
    ["fan below 75%", { fan: { pwmRatio: 0.749 } }],
    ["cooling state below 75%", { fan: { coolingState: 2, maxCoolingState: 4 } }],
    ["CPU below 70°C", { temperatureCelsius: 69.9 }],
    ["moderate memory pressure", { memory: { usedBytes: 900, totalBytes: 1000 } }],
    ["moderate CPU load", { cpu: { loadAvg1m: 6, physicalCores: 4 } }],
    ["unknown fan speed", { fan: { commandedOn: true } }],
    ["invalid cooling range", { fan: { coolingState: 3, maxCoolingState: 0 } }],
    ["PWM takes precedence", { fan: { pwmRatio: 0.5, coolingState: 4, maxCoolingState: 4 } }],
    ["no telemetry", {}],
  ])("does not warn for %s", (_label, snapshot) => {
    expect(aggregateSystemHealthSeverity(snapshot)).toBe("ok");
  });

  it.each<[string, BoothSystemSnapshot]>([
    ["fan at 75%", { fan: { pwmRatio: 0.75 } }],
    ["fan at full speed", { fan: { pwmRatio: 1 } }],
    ["third of four cooling levels", { fan: { coolingState: 3, maxCoolingState: 4 } }],
    ["CPU at 70°C", { temperatureCelsius: 70 }],
    ["CPU just below critical", { temperatureCelsius: 74.9 }],
    ["active throttling", { throttling: { throttled: true } }],
  ])("warns for %s", (_label, snapshot) => {
    expect(aggregateSystemHealthSeverity(snapshot)).toBe("warn");
  });

  it.each<[string, BoothSystemSnapshot]>([
    ["CPU at 75°C", { temperatureCelsius: 75 }],
    ["critical memory pressure", { memory: { usedBytes: 950, totalBytes: 1000 } }],
    ["critical CPU load", { cpu: { loadAvg1m: 8, physicalCores: 4 } }],
    ["lost Tailscale connection", { tailscale: { connected: false } }],
    ["critical fault with high fan speed", { fan: { pwmRatio: 1 }, temperatureCelsius: 80 }],
  ])("preserves critical alerts for %s", (_label, snapshot) => {
    expect(aggregateSystemHealthSeverity(snapshot)).toBe("crit");
  });
});
