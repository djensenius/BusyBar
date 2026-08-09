import type { BoothSystemSnapshot, BoothThrottlingFlags } from "./schemas.js";

export type SystemHealthSeverity = "ok" | "warn" | "crit";

export const SYSTEM_HEALTH_THRESHOLDS = {
  temperatureWarnCelsius: 60,
  temperatureCriticalCelsius: 75,
  memoryWarnRatio: 0.85,
  memoryCriticalRatio: 0.95,
} as const;

const temperatureSeverity = (value: number | null | undefined): SystemHealthSeverity => {
  if (typeof value !== "number") return "ok";
  if (value >= SYSTEM_HEALTH_THRESHOLDS.temperatureCriticalCelsius) return "crit";
  if (value >= SYSTEM_HEALTH_THRESHOLDS.temperatureWarnCelsius) return "warn";
  return "ok";
};

const memorySeverity = (
  used: number | null | undefined,
  total: number | null | undefined,
): SystemHealthSeverity => {
  if (typeof used !== "number" || typeof total !== "number" || total <= 0) return "ok";
  const ratio = used / total;
  if (ratio >= SYSTEM_HEALTH_THRESHOLDS.memoryCriticalRatio) return "crit";
  if (ratio >= SYSTEM_HEALTH_THRESHOLDS.memoryWarnRatio) return "warn";
  return "ok";
};

const loadSeverity = (
  value: number | null | undefined,
  cores: number | null | undefined,
): SystemHealthSeverity => {
  if (typeof value !== "number") return "ok";
  const reference = typeof cores === "number" && cores > 0 ? cores : 1;
  if (value >= reference * 2) return "crit";
  if (value >= reference) return "warn";
  return "ok";
};

export const activeThrottlingLabels = (
  flags: BoothThrottlingFlags | null | undefined,
): string[] => {
  if (!flags) return [];
  const labels: string[] = [];
  if (flags.undervoltage) labels.push("under-voltage");
  if (flags.armFreqCapped) labels.push("arm-freq-capped");
  if (flags.throttled) labels.push("throttled");
  if (flags.softTempLimit) labels.push("soft-temp-limit");
  if (flags.undervoltageOccurred) labels.push("under-voltage-occurred");
  if (flags.throttledOccurred) labels.push("throttled-occurred");
  return labels;
};

export const aggregateSystemHealthSeverity = (
  snapshot: BoothSystemSnapshot | null | undefined,
): SystemHealthSeverity => {
  if (!snapshot) return "ok";
  const cpu = snapshot.cpu;
  const memory = snapshot.memory;
  const cores =
    typeof cpu?.physicalCores === "number" && cpu.physicalCores > 0
      ? cpu.physicalCores
      : Array.isArray(cpu?.perCoreUsageRatio) && cpu.perCoreUsageRatio.length > 0
        ? cpu.perCoreUsageRatio.length
        : null;
  const severities: SystemHealthSeverity[] = [
    temperatureSeverity(snapshot.temperatureCelsius),
    memorySeverity(memory?.usedBytes, memory?.totalBytes),
    loadSeverity(cpu?.loadAvg1m, cores),
    activeThrottlingLabels(snapshot.throttling).length > 0 ? "warn" : "ok",
    snapshot.tailscale?.connected === false ? "crit" : "ok",
  ];
  return severities.reduce<SystemHealthSeverity>(
    (current, severity) =>
      severity === "crit" ? "crit" : severity === "warn" && current === "ok" ? "warn" : current,
    "ok",
  );
};
