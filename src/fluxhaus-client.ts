import { z } from "zod";
import type { FluxHausConfig } from "./config.js";
import { log } from "./logger.js";

export const FluxHausDeviceIdSchema = z.enum([
  "washer",
  "dryer",
  "dishwasher",
  "broombot",
  "mopbot",
  "airPurifier",
]);
export type FluxHausDeviceId = z.infer<typeof FluxHausDeviceIdSchema>;
export type FluxHausDeviceLifecycle =
  | "active"
  | "paused"
  | "finished"
  | "inactive"
  | "unknown";

export interface FluxHausDeviceStatus {
  id: FluxHausDeviceId;
  name: string;
  active: boolean;
  lifecycle: FluxHausDeviceLifecycle;
  status: string;
  detail: string | null;
  progressPercent: number | null;
  airQualityPm25?: number | null;
  remainingSeconds: number | null;
  elapsedSeconds?: number | null;
  batteryPercent: number | null;
  updatedAt: string | null;
}

export interface FluxHausCarStatus {
  batteryPercent: number;
  evRangeKm: number | null;
  totalRangeKm: number | null;
  charging: boolean;
  updatedAt: string;
}

export interface FluxHausSnapshot {
  devices: FluxHausDeviceStatus[];
  car: FluxHausCarStatus | null;
  generatedAt: string;
}

const DateStringSchema = z.string().datetime().nullable().optional();
const FiniteNumberSchema = z.number().finite();
const PercentSchema = FiniteNumberSchema.min(0).max(100);

const MieleDeviceSchema = z
  .object({
    timeRunning: FiniteNumberSchema.nonnegative().optional(),
    timeRemaining: FiniteNumberSchema.nonnegative().optional(),
    step: z.string().max(128).optional(),
    programName: z.string().max(128).optional(),
    status: z.string().max(128).optional(),
    inUse: z.boolean().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const DishwasherSchema = z
  .object({
    status: z.string().max(128).optional(),
    remainingTime: FiniteNumberSchema.nonnegative().optional(),
    remainingTimeUnit: z.enum(["seconds", "minutes", "hours"]).optional(),
    programProgress: PercentSchema.optional(),
    operationState: z.string().max(128).optional(),
    activeProgram: z.string().max(128).optional(),
    selectedProgram: z.string().max(128).optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const RobotSchema = z
  .object({
    running: z.boolean().optional(),
    docking: z.boolean().optional(),
    docked: z.union([z.boolean(), z.string()]).optional(),
    charging: z.boolean().optional(),
    paused: z.boolean().optional(),
    batteryLevel: PercentSchema.optional(),
    timestamp: DateStringSchema,
    timeStarted: DateStringSchema,
  })
  .passthrough()
  .nullable()
  .optional();

const AirPurifierSchema = z
  .object({
    timestamp: DateStringSchema,
    online: z.boolean().optional(),
    fanOn: z.boolean().optional(),
    fanSpeed: PercentSchema.optional().nullable(),
    presetMode: z.string().max(128).optional().nullable(),
    pm25: FiniteNumberSchema.optional().nullable(),
    filterLife: PercentSchema.optional().nullable(),
  })
  .passthrough()
  .nullable()
  .optional();

const RangeSchema = z
  .object({
    value: FiniteNumberSchema.nonnegative(),
  })
  .passthrough();

const CarEvStatusSchema = z
  .object({
    timestamp: DateStringSchema,
    batteryCharge: z.boolean().optional(),
    batteryStatus: PercentSchema.optional(),
    drvDistance: z
      .array(
        z
          .object({
            rangeByFuel: z
              .object({
                evModeRange: RangeSchema.optional(),
                totalAvailableRange: RangeSchema.optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const FluxHausResponseSchema = z
  .object({
    timestamp: z.string().datetime().optional(),
    washer: MieleDeviceSchema,
    dryer: MieleDeviceSchema,
    dishwasher: DishwasherSchema,
    broombot: RobotSchema,
    mopbot: RobotSchema,
    airPurifier: AirPurifierSchema,
    carEvStatus: CarEvStatusSchema,
  })
  .passthrough();

const clampPercent = (value: number | null | undefined): number | null =>
  typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;

const normalizeText = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const formatApplianceDisplayText = (
  value: string | null | undefined,
): string | null => {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;

  const normalized = trimmed.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  const firstLetter = normalized.match(/[A-Za-z]/)?.[0];
  if (!trimmed.includes("_") && firstLetter && firstLetter === firstLetter.toUpperCase()) {
    return normalized;
  }
  return normalized.replace(
    /[A-Za-z]+/g,
    (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
  );
};

const normalizeMiele = (
  id: "washer" | "dryer",
  name: string,
  device: z.infer<typeof MieleDeviceSchema>,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const delayed = device.status === "Programmed" || device.status === "Waiting to start";
  const paused = device.status === "Pause";
  const finished = device.status === "End programmed";
  const remainingMinutes = device.timeRemaining ?? null;
  const active = !delayed && !paused && !finished && (remainingMinutes ?? 0) > 0;
  const elapsedMinutes = device.timeRunning ?? null;
  const totalMinutes =
    remainingMinutes !== null && elapsedMinutes !== null
      ? remainingMinutes + elapsedMinutes
      : null;
  return {
    id,
    name,
    active,
    lifecycle: finished
      ? "finished"
      : paused
        ? "paused"
        : delayed
          ? "unknown"
          : active
            ? "active"
            : device.status === "Off" || device.status === "Not Connected"
              ? "inactive"
              : "unknown",
    status: formatApplianceDisplayText(device.status) ?? (device.inUse ? "In use" : "Off"),
    detail:
      formatApplianceDisplayText(device.step) ??
      formatApplianceDisplayText(device.programName),
    progressPercent:
      totalMinutes !== null && totalMinutes > 0 && elapsedMinutes !== null
        ? clampPercent((elapsedMinutes / totalMinutes) * 100)
        : null,
    remainingSeconds: remainingMinutes === null ? null : Math.round(remainingMinutes * 60),
    elapsedSeconds: null,
    batteryPercent: null,
    updatedAt: null,
  };
};

const secondsFor = (
  value: number | undefined,
  unit: "seconds" | "minutes" | "hours" | undefined,
): number | null => {
  if (value === undefined) return null;
  if (unit === "hours") return Math.round(value * 3600);
  if (unit === "minutes") return Math.round(value * 60);
  return Math.round(value);
};

const normalizeDishwasher = (
  device: z.infer<typeof DishwasherSchema>,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const active = device.operationState === "Run" && (device.programProgress ?? 0) > 0;
  const lifecycle: FluxHausDeviceLifecycle =
    active
      ? "active"
      : device.operationState === "Pause"
        ? "paused"
        : device.operationState === "Finished"
          ? "finished"
          : device.operationState === "Run"
            ? "unknown"
            : device.operationState === "Inactive"
              ? "inactive"
              : "unknown";
  return {
    id: "dishwasher",
    name: "Dishwasher",
    active: lifecycle === "active",
    lifecycle,
    status:
      formatApplianceDisplayText(device.status) ??
      formatApplianceDisplayText(device.operationState) ??
      "Inactive",
    detail:
      formatApplianceDisplayText(device.activeProgram) ??
      formatApplianceDisplayText(device.selectedProgram),
    progressPercent: clampPercent(device.programProgress),
    remainingSeconds: secondsFor(device.remainingTime, device.remainingTimeUnit),
    elapsedSeconds: null,
    batteryPercent: null,
    updatedAt: null,
  };
};

const normalizeRobot = (
  id: "broombot" | "mopbot",
  name: string,
  device: z.infer<typeof RobotSchema>,
  now: Date,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const active = device.running === true || device.docking === true;
  const docked =
    device.docked === true ||
    device.docked === "CONTACT_DETECTED" ||
    device.charging === true;
  const lifecycle: FluxHausDeviceLifecycle = active
    ? "active"
    : device.paused
      ? "paused"
      : docked
        ? "finished"
        : device.running === false
          ? "inactive"
          : "unknown";
  const status = device.running
    ? "Cleaning"
    : device.docking
      ? "Returning"
      : device.paused
        ? "Paused"
        : device.charging
          ? "Charging"
          : docked
            ? "Docked"
            : device.running === false
              ? "Stopped"
              : "Unknown";
  return {
    id,
    name,
    active,
    lifecycle,
    status,
    detail: null,
    progressPercent: null,
    remainingSeconds: null,
    elapsedSeconds:
      device.timeStarted == null
        ? null
        : Math.max(0, Math.round((now.getTime() - Date.parse(device.timeStarted)) / 1000)),
    batteryPercent: clampPercent(device.batteryLevel),
    updatedAt: device.timestamp ?? null,
  };
};

const normalizeAirPurifier = (
  device: z.infer<typeof AirPurifierSchema>,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const preset = normalizeText(device.presetMode);
  return {
    id: "airPurifier",
    name: "Air purifier",
    active: device.fanOn === true,
    lifecycle: device.fanOn === true ? "active" : "inactive",
    status: device.fanOn ? (preset ?? "Running") : device.online === false ? "Offline" : "Off",
    detail: null,
    progressPercent: clampPercent(device.fanSpeed),
    airQualityPm25: device.pm25 ?? null,
    remainingSeconds: null,
    elapsedSeconds: null,
    batteryPercent: null,
    updatedAt: device.timestamp ?? null,
  };
};

const normalizeCar = (
  car: z.infer<typeof CarEvStatusSchema>,
): FluxHausCarStatus | null => {
  if (!car?.timestamp || car.batteryStatus === undefined) return null;
  const range = car.drvDistance?.[0]?.rangeByFuel;
  return {
    batteryPercent: Math.max(0, Math.min(100, car.batteryStatus)),
    evRangeKm: range?.evModeRange?.value ?? range?.totalAvailableRange?.value ?? null,
    totalRangeKm: range?.totalAvailableRange?.value ?? null,
    charging: car.batteryCharge === true,
    updatedAt: car.timestamp,
  };
};

export const parseFluxHausSnapshot = (input: unknown, now = new Date()): FluxHausSnapshot => {
  const response = FluxHausResponseSchema.parse(input);
  const devices = [
    normalizeMiele("washer", "Washer", response.washer),
    normalizeMiele("dryer", "Dryer", response.dryer),
    normalizeDishwasher(response.dishwasher),
    normalizeRobot("broombot", "BroomBot", response.broombot, now),
    normalizeRobot("mopbot", "MopBot", response.mopbot, now),
    normalizeAirPurifier(response.airPurifier),
  ].filter((device): device is FluxHausDeviceStatus => device !== null);
  return {
    devices,
    car: normalizeCar(response.carEvStatus),
    generatedAt: response.timestamp ?? now.toISOString(),
  };
};

export const readFluxHausSnapshot = async (
  config: FluxHausConfig,
): Promise<FluxHausSnapshot> => {
  const response = await fetch(new URL("/", config.url), {
    headers: {
      authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`FluxHaus API returned ${response.status} for /`);
  }
  return parseFluxHausSnapshot(await response.json());
};

export interface FluxHausMonitor {
  updateFluxHaus(snapshot: FluxHausSnapshot, receivedAtMs?: number): void;
}

export interface FluxHausFeedHandle {
  stop(): void;
}

export const startFluxHausPolling = (
  config: FluxHausConfig,
  monitor: FluxHausMonitor,
): FluxHausFeedHandle => {
  let stopped = false;
  let polling = false;
  let timer: NodeJS.Timeout | null = null;

  const poll = async (): Promise<void> => {
    if (stopped || polling) return;
    polling = true;
    try {
      const snapshot = await readFluxHausSnapshot(config);
      if (!stopped) monitor.updateFluxHaus(snapshot);
    } catch (error) {
      log.warn({ err: error }, "FluxHaus status poll failed");
    } finally {
      polling = false;
    }
  };

  void poll();
  timer = setInterval(() => {
    void poll();
  }, config.pollIntervalMs);
  timer.unref();
  return {
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
};
