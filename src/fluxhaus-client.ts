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
  remainingSeconds: number | null;
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
    programProgress: FiniteNumberSchema.optional(),
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
    batteryLevel: FiniteNumberSchema.optional(),
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
    fanSpeed: FiniteNumberSchema.optional().nullable(),
    presetMode: z.string().max(128).optional().nullable(),
    pm25: FiniteNumberSchema.optional().nullable(),
    filterLife: FiniteNumberSchema.optional().nullable(),
  })
  .passthrough()
  .nullable()
  .optional();

const RangeSchema = z
  .object({
    value: FiniteNumberSchema,
  })
  .passthrough();

const CarEvStatusSchema = z
  .object({
    timestamp: z.string().datetime(),
    batteryCharge: z.boolean().optional(),
    batteryStatus: FiniteNumberSchema,
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

const normalizeMiele = (
  id: "washer" | "dryer",
  name: string,
  device: z.infer<typeof MieleDeviceSchema>,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const delayed = device.status === "Programmed" || device.status === "Waiting to start";
  const paused = device.status === "Pause";
  const finished = device.status === "End programmed";
  const explicitlyRunning =
    device.status === "Running" || device.status === "In use" || device.inUse === true;
  const remainingMinutes = device.timeRemaining ?? null;
  const elapsedMinutes = device.timeRunning ?? null;
  const totalMinutes =
    remainingMinutes !== null && elapsedMinutes !== null
      ? remainingMinutes + elapsedMinutes
      : null;
  return {
    id,
    name,
    active: !delayed && !paused && !finished && (explicitlyRunning || (remainingMinutes ?? 0) > 0),
    lifecycle: finished
      ? "finished"
      : paused
        ? "paused"
        : delayed
          ? "inactive"
          : explicitlyRunning || (remainingMinutes ?? 0) > 0
            ? "active"
            : device.status
              ? "inactive"
              : "unknown",
    status: normalizeText(device.status) ?? (device.inUse ? "In use" : "Off"),
    detail: normalizeText(device.step) ?? normalizeText(device.programName),
    progressPercent:
      totalMinutes !== null && totalMinutes > 0 && elapsedMinutes !== null
        ? clampPercent((elapsedMinutes / totalMinutes) * 100)
        : null,
    remainingSeconds: remainingMinutes === null ? null : Math.round(remainingMinutes * 60),
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
  const lifecycle: FluxHausDeviceLifecycle =
    device.operationState === "Run"
      ? "active"
      : device.operationState === "Pause"
        ? "paused"
        : device.operationState === "Finished"
          ? "finished"
          : device.operationState
            ? "inactive"
            : "unknown";
  return {
    id: "dishwasher",
    name: "Dishwasher",
    active: lifecycle === "active",
    lifecycle,
    status: normalizeText(device.status) ?? normalizeText(device.operationState) ?? "Inactive",
    detail: normalizeText(device.activeProgram) ?? normalizeText(device.selectedProgram),
    progressPercent: clampPercent(device.programProgress),
    remainingSeconds: secondsFor(device.remainingTime, device.remainingTimeUnit),
    batteryPercent: null,
    updatedAt: null,
  };
};

const normalizeRobot = (
  id: "broombot" | "mopbot",
  name: string,
  device: z.infer<typeof RobotSchema>,
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
        : "inactive";
  const status = device.running
    ? "Cleaning"
    : device.docking
      ? "Returning"
      : device.paused
        ? "Paused"
        : device.charging
          ? "Charging"
          : "Docked";
  return {
    id,
    name,
    active,
    lifecycle,
    status,
    detail: null,
    progressPercent: null,
    remainingSeconds: null,
    batteryPercent: clampPercent(device.batteryLevel),
    updatedAt: device.timestamp ?? null,
  };
};

const normalizeAirPurifier = (
  device: z.infer<typeof AirPurifierSchema>,
): FluxHausDeviceStatus | null => {
  if (!device) return null;
  const preset = normalizeText(device.presetMode);
  const pm25 =
    device.pm25 === null || device.pm25 === undefined
      ? null
      : `PM${Math.round(device.pm25)}`;
  return {
    id: "airPurifier",
    name: "Air purifier",
    active: device.online === true && device.fanOn === true,
    lifecycle: device.online === true && device.fanOn === true ? "active" : "inactive",
    status: device.online === false ? "Offline" : device.fanOn ? "Running" : "Off",
    detail: [preset, pm25].filter((value): value is string => value !== null).join(" ") || null,
    progressPercent: clampPercent(device.fanSpeed),
    remainingSeconds: null,
    batteryPercent: null,
    updatedAt: device.timestamp ?? null,
  };
};

const normalizeCar = (
  car: z.infer<typeof CarEvStatusSchema>,
): FluxHausCarStatus | null => {
  if (!car) return null;
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
    normalizeRobot("broombot", "BroomBot", response.broombot),
    normalizeRobot("mopbot", "MopBot", response.mopbot),
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
