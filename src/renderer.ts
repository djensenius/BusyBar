import type { DisplayDrawParams, RectangleElement, TextElement } from "@busy-app/busy-lib";
import {
  SYSTEM_HEALTH_THRESHOLDS,
  activeThrottlingLabels,
  aggregateSystemHealthSeverity,
} from "./health.js";
import type { SystemHealthSeverity } from "./health.js";
import type { MonitorConfig } from "./config.js";
import type { SceneStatus } from "./home-assistant-client.js";
import {
  boothArtElements,
  degreeElement,
  frontRectangle,
  warningArtElements,
  weatherIconElements,
} from "./front-art.js";
import type {
  BoothFanStats,
  BoothState,
  BoothStatus,
  BoothSystemSnapshotEnvelope,
  MonitorSummary,
  RouterTelemetryEnvelope,
} from "./schemas.js";
import type { WeatherCondition, WeatherSnapshot } from "./weather-client.js";

export type SummaryFrontFrame =
  | "interactionsToday"
  | "messagesToday"
  | "interactionsTotal"
  | "messagesTotal"
  | "messagePlaybackStartsTotal"
  | "noSelectionToday"
  | "wrongNumberAttemptsToday"
  | "messagesLeftToday"
  | "messagePlaybackStartsToday"
  | "instructionPlaybackStartsToday";
export type FrontFrame =
  | SummaryFrontFrame
  | "fanCooling"
  | "piCpuTemperature"
  | "routerBatteryCharge"
  | "routerBatteryTemperature"
  | "clock"
  | "weather";
export type IdleMode = "weather" | "clock" | "weatherClock" | "telephone" | "all";
export type BackPage = 0 | 1 | 2 | 3;
export interface SceneAnnouncement {
  label: string;
  phase: 0 | 1 | 2;
}

export interface SmartHomeAction {
  sceneId: string;
  result: "checking" | "activated" | "lightsOff" | "failed";
}

export interface MonitorState {
  status: BoothStatus | null;
  statusReceivedAtMs: number | null;
  system: BoothSystemSnapshotEnvelope | null;
  systemReceivedAtMs: number | null;
  routerTelemetry: RouterTelemetryEnvelope | null;
  routerTelemetryReceivedAtMs: number | null;
  summary: MonitorSummary | null;
  weather: WeatherSnapshot | null;
  weatherReceivedAtMs: number | null;
  frontFrame: FrontFrame;
  idleMode: IdleMode;
  idleModeAnnouncement: IdleMode | null;
  sceneAnnouncement: SceneAnnouncement | null;
  smartHomeStatus: SceneStatus | null;
  smartHomeAction: SmartHomeAction | null;
  backPage: BackPage;
  cloudConnected: boolean;
}

export interface MonitorRender {
  payload: DisplayDrawParams;
  frontSignature: string;
  backSignature: string;
  signature: string;
  alertKind: "error" | "offline" | "critical" | null;
}

export const DEFAULT_FRONT_FRAME: SummaryFrontFrame = "interactionsToday";

const BASE_TELEPHONE_FRAMES: readonly SummaryFrontFrame[] = [
  "interactionsToday",
  "messagesToday",
  "interactionsTotal",
  "messagesTotal",
];

const CORE_ALL_TIME_TELEPHONE_FRAMES: readonly SummaryFrontFrame[] = [
  "interactionsTotal",
  "messagesTotal",
];

const OPTIONAL_ALL_TIME_TELEPHONE_FRAMES: readonly SummaryFrontFrame[] = [
  "messagePlaybackStartsTotal",
];

const ROUTER_TELEMETRY_STALE_AFTER_MS = 5 * 60_000;

const COLORS = {
  blueDark: "#003B7AFF",
  amber: "#FAAB00FF",
  amberDark: "#865B00FF",
  cyan: "#00C8FFFF",
  cyanDark: "#006A85FF",
  cyanMuted: "#43A9BCFF",
  red: "#FB2C36FF",
  redDark: "#7A1118FF",
  violet: "#A855F7FF",
  violetDark: "#4C1D95FF",
  slate: "#34445CFF",
  slateDark: "#101827FF",
  yellow: "#FFD057FF",
  ice: "#D9EFFFFF",
  black: "#041616FF",
  trueBlack: "#000000FF",
  white: "#FFFFFFFF",
  transparent: "#00000000",
} as const;

const PICKUP_FRONT_LABEL = "PICKUP";
const PICKUP_REAR_LABEL = "PICKUPS";

type Gradient = readonly [string, string];
type DisplayElement = DisplayDrawParams["elements"][number];
const FRONT_RECTANGLE_SLOT_COUNT = 24;
const FRONT_TEXT_SLOT_COUNT = 5;
const BACK_RECTANGLE_SLOT_COUNT = 18;
const BACK_TEXT_SLOT_COUNT = 14;

interface FrontPresentation {
  readonly elements: DisplayElement[];
  readonly indicator?: string;
}

interface BackPresentation {
  readonly elements: DisplayElement[];
}

interface HealthPresentation {
  readonly view: FrontPresentation | null;
  readonly severity: SystemHealthSeverity;
  readonly offline: boolean;
}

const sanitize = (input: string, maximum: number): string =>
  input
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

const frontText = (
  id: string,
  value: string,
  x: number,
  y: number,
  font: TextElement["font"],
  color: string = COLORS.white,
  align: NonNullable<TextElement["align"]> = "center",
  width?: number,
): TextElement => ({
  id,
  type: "text",
  x,
  y,
  display: "front",
  align,
  text: sanitize(value, 18),
  font,
  color,
  ...(width === undefined ? {} : { width }),
});

const frontBackground = (gradient: Gradient): RectangleElement => ({
  id: "front-background",
  type: "rectangle",
  x: 0,
  y: 0,
  display: "front",
  align: "top_left",
  width: 72,
  height: 16,
  fill: "gradient_h",
  fill_colors: [...gradient],
  border_width: 0,
  border_color: COLORS.transparent,
});

const stableFrontElements = (elements: readonly DisplayElement[]): DisplayElement[] => {
  const rectangles = elements.filter(
    (element): element is RectangleElement => element.type === "rectangle",
  );
  const texts = elements.filter((element): element is TextElement => element.type === "text");
  if (
    rectangles.length + texts.length !== elements.length ||
    rectangles.length > FRONT_RECTANGLE_SLOT_COUNT ||
    texts.length > FRONT_TEXT_SLOT_COUNT
  ) {
    throw new Error("Front presentation exceeds the reusable BUSY Bar element slots");
  }

  return [
    ...Array.from({ length: FRONT_RECTANGLE_SLOT_COUNT }, (_, index) => {
      const rectangle = rectangles[index];
      return rectangle
        ? { ...rectangle, id: `front-rectangle-slot-${index}` }
        : frontRectangle(
            `front-rectangle-slot-${index}`,
            0,
            0,
            1,
            1,
            COLORS.transparent,
          );
    }),
    ...Array.from({ length: FRONT_TEXT_SLOT_COUNT }, (_, index): TextElement => {
      const text = texts[index];
      return text
        ? { ...text, id: `front-text-slot-${index}` }
        : {
            id: `front-text-slot-${index}`,
            type: "text",
            x: 0,
            y: 0,
            display: "front",
            align: "top_left",
            text: "",
            font: "tiny",
            color: COLORS.transparent,
          };
    }),
  ];
};

const labelPresentation = (
  label: string,
  background: Gradient,
  art: readonly DisplayElement[],
  centerX: number,
  indicator?: string,
): FrontPresentation => ({
  elements: [
    frontBackground(background),
    ...art,
    frontText(
      "front-label",
      label,
      centerX,
      8,
      label.length <= 7 ? "large" : label.length <= 9 ? "condensed" : "small",
      COLORS.white,
    ),
  ],
  ...(indicator ? { indicator } : {}),
});

const warningPresentation = (
  label: string,
  background: Gradient,
  color: string,
  indicator?: string,
): FrontPresentation =>
  labelPresentation(label, background, warningArtElements("front-warning", color), 44, indicator);

const statePresentation = (state: Exclude<BoothState, "idle">): FrontPresentation => {
  if (state === "dialTone" || state === "dialing") {
    return labelPresentation(
      "CALLING",
      [COLORS.amberDark, COLORS.amber],
      boothArtElements("front-booth", "calling"),
      44,
    );
  }
  if (
    state === "playingQuestion" ||
    state === "playingMessage" ||
    state === "playingInstructions"
  ) {
    return labelPresentation(
      "PLAYING",
      [COLORS.cyanDark, COLORS.cyan],
      boothArtElements("front-booth", "active"),
      44,
    );
  }
  if (state === "beep" || state === "recording") {
    return labelPresentation(
      "RECORDING",
      [COLORS.redDark, COLORS.red],
      boothArtElements("front-booth", "recording"),
      44,
      COLORS.red,
    );
  }
  if (state === "uploading") {
    return labelPresentation(
      "SENDING",
      [COLORS.violetDark, COLORS.violet],
      boothArtElements("front-booth", "active"),
      44,
    );
  }
  if (state === "callUnavailable") {
    return labelPresentation(
      "UNAVAILABLE",
      [COLORS.amberDark, COLORS.amber],
      boothArtElements("front-booth", "active"),
      44,
      COLORS.amber,
    );
  }
  return warningPresentation("ERROR", [COLORS.redDark, COLORS.red], COLORS.red, COLORS.red);
};

const ageMs = (timestampMs: number | null | undefined, nowMs: number): number =>
  timestampMs != null && Number.isFinite(timestampMs)
    ? Math.max(0, nowMs - timestampMs)
    : Number.POSITIVE_INFINITY;

export const statusIsStale = (
  statusReceivedAtMs: number | null,
  nowMs: number,
  staleAfterMs: number,
): boolean => statusReceivedAtMs === null || Math.max(0, nowMs - statusReceivedAtMs) > staleAfterMs;

interface FanCoolingPresentation {
  readonly ratio: number;
  readonly label: "OFF" | "LOW" | "MEDIUM" | "HIGH" | "MAX" | "ON";
}

type FanLevelStep = 0 | 1 | 2 | 3 | 4;

const clampRatio = (value: number): number => Math.max(0, Math.min(1, value));

const fanLevelStep = (ratio: number): FanLevelStep => {
  const value = clampRatio(ratio);
  if (value <= 0) return 0;
  if (value <= 0.32) return 1;
  if (value <= 0.52) return 2;
  if (value <= 0.82) return 3;
  return 4;
};

const fanLevelLabel = (ratio: number): FanCoolingPresentation["label"] =>
  (["OFF", "LOW", "MEDIUM", "HIGH", "MAX"] as const)[fanLevelStep(ratio)];

const fanCoolingPresentation = (
  fan: BoothFanStats | null | undefined,
): FanCoolingPresentation | null => {
  if (!fan) return null;
  if (typeof fan.pwmRatio === "number") {
    const ratio = clampRatio(fan.pwmRatio);
    return { ratio, label: fanLevelLabel(ratio) };
  }
  if (
    typeof fan.coolingState === "number" &&
    typeof fan.maxCoolingState === "number" &&
    fan.maxCoolingState > 0
  ) {
    const ratio = clampRatio(fan.coolingState / fan.maxCoolingState);
    return { ratio, label: fanLevelLabel(ratio) };
  }
  if (fan.commandedOn === false) return { ratio: 0, label: "OFF" };
  if (fan.commandedOn === true) return { ratio: 0.5, label: "ON" };
  return null;
};

export const availableFrontFrames = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): FrontFrame[] => {
  const systemFresh =
    state.system !== null && ageMs(state.systemReceivedAtMs, nowMs) <= config.systemStaleAfterMs;
  const snapshot = systemFresh ? state.system?.snapshot : null;
  const routerFresh =
    state.routerTelemetry !== null &&
    ageMs(state.routerTelemetryReceivedAtMs, nowMs) <= ROUTER_TELEMETRY_STALE_AFTER_MS;
  const battery = routerFresh ? state.routerTelemetry?.latestSnapshot?.battery : null;
  const vitalFrames: FrontFrame[] = [
    ...(fanCoolingPresentation(snapshot?.fan) ? (["fanCooling"] satisfies FrontFrame[]) : []),
    ...(typeof snapshot?.temperatureCelsius === "number"
      ? (["piCpuTemperature"] satisfies FrontFrame[])
      : []),
    ...(typeof battery?.chargePercent === "number"
      ? (["routerBatteryCharge"] satisfies FrontFrame[])
      : []),
    ...(typeof battery?.temperatureCelsius === "number"
      ? (["routerBatteryTemperature"] satisfies FrontFrame[])
      : []),
  ];
  const summaryFrames: FrontFrame[] = state.summary
    ? [
        ...(state.summary.interactionsToday === 0
          ? []
          : (["interactionsToday"] satisfies SummaryFrontFrame[])),
        ...(state.summary.messagesToday === 0
          ? []
          : (["messagesToday"] satisfies SummaryFrontFrame[])),
        ...CORE_ALL_TIME_TELEPHONE_FRAMES,
        ...(state.summary.messagePlaybackStartsTotal === undefined
          ? []
          : OPTIONAL_ALL_TIME_TELEPHONE_FRAMES),
        ...(state.summary.breakdownToday?.noSelection === 0
          ? []
          : state.summary.breakdownToday
            ? (["noSelectionToday"] satisfies SummaryFrontFrame[])
            : []),
        ...(state.summary.breakdownToday?.wrongNumberAttempts === 0
          ? []
          : state.summary.breakdownToday
            ? (["wrongNumberAttemptsToday"] satisfies SummaryFrontFrame[])
            : []),
        ...(state.summary.breakdownToday?.messagesLeft === 0
          ? []
          : state.summary.breakdownToday
            ? (["messagesLeftToday"] satisfies SummaryFrontFrame[])
            : []),
        ...(state.summary.breakdownToday?.messagePlaybackStarts === 0
          ? []
          : state.summary.breakdownToday
            ? (["messagePlaybackStartsToday"] satisfies SummaryFrontFrame[])
            : []),
        ...(state.summary.breakdownToday?.instructionPlaybackStarts === 0
          ? []
          : state.summary.breakdownToday
            ? (["instructionPlaybackStartsToday"] satisfies SummaryFrontFrame[])
            : []),
      ]
    : [...BASE_TELEPHONE_FRAMES];
  const telephoneFrames = [...summaryFrames, ...vitalFrames];
  const weatherAvailable = Boolean(
    config.weather &&
      state.weather &&
      ageMs(state.weatherReceivedAtMs, nowMs) <= config.weather.staleAfterMs,
  );
  const selectedFrames =
    state.idleMode === "weather"
      ? weatherAvailable
        ? (["weather"] satisfies FrontFrame[])
        : []
      : state.idleMode === "clock"
        ? config.clockEnabled
          ? (["clock"] satisfies FrontFrame[])
          : []
        : state.idleMode === "weatherClock"
          ? [
              ...(weatherAvailable ? (["weather"] satisfies FrontFrame[]) : []),
              ...(config.clockEnabled ? (["clock"] satisfies FrontFrame[]) : []),
            ]
          : state.idleMode === "telephone"
            ? telephoneFrames
            : [
                ...telephoneFrames,
                ...(config.clockEnabled ? (["clock"] satisfies FrontFrame[]) : []),
                ...(weatherAvailable ? (["weather"] satisfies FrontFrame[]) : []),
              ];
  return selectedFrames.length > 0 ? selectedFrames : telephoneFrames;
};

const healthPresentation = (
  state: MonitorState,
  nowMs: number,
  systemStaleAfterMs: number,
): HealthPresentation => {
  if (
    !state.system ||
    ageMs(state.systemReceivedAtMs, nowMs) > systemStaleAfterMs ||
    !state.cloudConnected
  ) {
    return {
      view: warningPresentation(
        "OFFLINE",
        [COLORS.redDark, COLORS.red],
        COLORS.red,
        COLORS.red,
      ),
      severity: "crit",
      offline: true,
    };
  }
  const snapshot = state.system.snapshot;
  const throttling = activeThrottlingLabels(snapshot.throttling);
  if (
    snapshot.temperatureCelsius != null &&
    snapshot.temperatureCelsius >= SYSTEM_HEALTH_THRESHOLDS.temperatureCriticalCelsius
  ) {
    return {
      view: warningPresentation("HOT", [COLORS.redDark, COLORS.red], COLORS.red, COLORS.red),
      severity: "crit",
      offline: false,
    };
  }
  const severity = aggregateSystemHealthSeverity(snapshot);
  if (severity === "crit") {
    return {
      view: warningPresentation(
        "SYSTEM CRIT",
        [COLORS.redDark, COLORS.red],
        COLORS.red,
        COLORS.red,
      ),
      severity,
      offline: false,
    };
  }
  if (throttling.length > 0) {
    return {
      view: warningPresentation(
        "THROTTLED",
        [COLORS.amberDark, COLORS.amber],
        COLORS.amber,
        COLORS.amber,
      ),
      severity: "warn",
      offline: false,
    };
  }
  if (severity === "warn") {
    return {
      view: warningPresentation(
        "SYSTEM WARN",
        [COLORS.amberDark, COLORS.amber],
        COLORS.amber,
        COLORS.amber,
      ),
      severity,
      offline: false,
    };
  }
  return {
    view: null,
    severity,
    offline: false,
  };
};

const backText = (
  id: string,
  value: string,
  x: number,
  y: number,
  font: TextElement["font"],
  color: string = COLORS.white,
  align: NonNullable<TextElement["align"]> = "top_left",
  width?: number,
): TextElement => ({
  id,
  type: "text",
  x,
  y,
  display: "back",
  align,
  text: sanitize(value, 36),
  font,
  color,
  ...(width === undefined ? {} : { width }),
});

const backRectangle = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): RectangleElement => ({
  id,
  type: "rectangle",
  x,
  y,
  display: "back",
  align: "top_left",
  width,
  height,
  fill: "solid",
  fill_colors: [color],
  border_width: 0,
  border_color: COLORS.transparent,
});

const stableBackElements = (elements: readonly DisplayElement[]): DisplayElement[] => {
  const rectangles = elements.filter(
    (element): element is RectangleElement => element.type === "rectangle",
  );
  const texts = elements.filter((element): element is TextElement => element.type === "text");
  if (
    rectangles.length + texts.length !== elements.length ||
    rectangles.length > BACK_RECTANGLE_SLOT_COUNT ||
    texts.length > BACK_TEXT_SLOT_COUNT
  ) {
    throw new Error("Rear presentation exceeds the reusable BUSY Bar element slots");
  }
  return [
    ...Array.from({ length: BACK_RECTANGLE_SLOT_COUNT }, (_, index) => {
      const rectangle = rectangles[index];
      return rectangle
        ? { ...rectangle, id: `back-rectangle-slot-${index}` }
        : backRectangle(`back-rectangle-slot-${index}`, 0, 0, 1, 1, COLORS.transparent);
    }),
    ...Array.from({ length: BACK_TEXT_SLOT_COUNT }, (_, index): TextElement => {
      const text = texts[index];
      return text
        ? { ...text, id: `back-text-slot-${index}` }
        : backText(`back-text-slot-${index}`, "", 0, 0, "tiny", COLORS.transparent);
    }),
  ];
};

const shortId = (value: string | null | undefined): string => (value ? value.slice(0, 8) : "--");

const percent = (used: number | null | undefined, total: number | null | undefined): string =>
  typeof used === "number" && typeof total === "number" && total > 0
    ? `${Math.round((used / total) * 100)}%`
    : "--";

const compactUptime = (seconds: number | null | undefined): string => {
  if (typeof seconds !== "number") return "--";
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days > 0) return `${days}D ${hours}H`;
  return `${hours}H ${minutes % 60}M`;
};

const fanLevelBackElements = (fan: FanCoolingPresentation | null): RectangleElement[] => {
  const ratio = fan?.ratio ?? 0;
  const step = fan ? fanLevelStep(ratio) : 0;
  const bars = [
    [8, 50, 8, 10],
    [20, 42, 8, 18],
    [32, 34, 8, 26],
    [44, 26, 8, 34],
  ] as const;
  return bars.map(([x, y, width, height], index) =>
    backRectangle(
      `back-fan-level-${index}`,
      x,
      y,
      width,
      height,
      index < step ? COLORS.white : COLORS.slate,
    ),
  );
};

const systemVitalsBackPresentation = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): BackPresentation => {
  const systemFresh =
    state.system !== null && ageMs(state.systemReceivedAtMs, nowMs) <= config.systemStaleAfterMs;
  const snapshot = systemFresh ? state.system?.snapshot : null;
  const routerFresh =
    state.routerTelemetry !== null &&
    ageMs(state.routerTelemetryReceivedAtMs, nowMs) <= ROUTER_TELEMETRY_STALE_AFTER_MS;
  const battery = routerFresh ? state.routerTelemetry?.latestSnapshot?.battery : null;
  const fan = fanCoolingPresentation(snapshot?.fan);
  const cpu = snapshot?.cpu;
  const memory = snapshot?.memory;
  return {
    elements: [
      backRectangle("back-vitals-header-rule", 0, 11, 160, 1, COLORS.slate),
      backRectangle("back-vitals-fan-rule", 64, 14, 1, 64, COLORS.slate),
      backRectangle("back-vitals-pi-rule", 113, 14, 1, 64, COLORS.slate),
      ...fanLevelBackElements(fan),
      backText("back-vitals-title", "BOOTH VITALS", 2, 1, "bold"),
      backText("back-vitals-fan", "FAN", 4, 15, "small", COLORS.ice),
      backText("back-vitals-fan-level", fan?.label ?? "--", 4, 68, "small"),
      backText("back-vitals-pi", "PI", 69, 15, "small", COLORS.ice),
      backText(
        "back-vitals-pi-temp",
        snapshot?.temperatureCelsius == null
          ? "-- C"
          : `${snapshot.temperatureCelsius.toFixed(1)} C`,
        69,
        27,
        "normal",
      ),
      backText(
        "back-vitals-pi-cpu",
        `CPU ${cpu?.usageRatio == null ? "--" : `${Math.round(cpu.usageRatio * 100)}%`}`,
        69,
        43,
        "small",
      ),
      backText(
        "back-vitals-pi-memory",
        `MEM ${percent(memory?.usedBytes, memory?.totalBytes)}`,
        69,
        54,
        "small",
      ),
      backText(
        "back-vitals-pi-up",
        `UP ${compactUptime(snapshot?.uptimeSeconds)}`,
        69,
        65,
        "small",
      ),
      backText("back-vitals-router", "ROUTER", 117, 15, "small", COLORS.ice),
      backText(
        "back-vitals-battery-charge",
        battery?.chargePercent == null ? "--%" : `${Math.round(battery.chargePercent)}%`,
        117,
        27,
        "normal",
      ),
      backText("back-vitals-battery-label", "BATTERY", 117, 40, "tiny", COLORS.ice),
      backText(
        "back-vitals-battery-temp",
        battery?.temperatureCelsius == null
          ? "TEMP -- C"
          : `TEMP ${battery.temperatureCelsius.toFixed(1)} C`,
        117,
        49,
        "small",
      ),
      backText(
        "back-vitals-battery-voltage",
        battery?.voltageVolts == null ? "VOLT -- V" : `VOLT ${battery.voltageVolts.toFixed(2)} V`,
        117,
        59,
        "small",
      ),
      backText(
        "back-vitals-battery-current",
        battery?.currentAmperes == null
          ? "CURR -- A"
          : `CURR ${battery.currentAmperes.toFixed(2)} A`,
        117,
        69,
        "small",
      ),
    ],
  };
};

const sceneLabel = (entityId: string | null): string =>
  entityId
    ? entityId.replace(/^scene\./, "").replace(/_/g, " ").toUpperCase().slice(0, 18)
    : "--";

const brightnessLevel = (brightness: number | null): string =>
  brightness === null ? "ON" : `${Math.round((brightness / 255) * 100)}%`;

const currentLightLevel = (state: string, brightness: number | null): string => {
  if (state === "off") return "OFF";
  if (state !== "on") return "--";
  return brightnessLevel(brightness);
};

const lightCode = (entityId: string): string => {
  const words = entityId
    .replace(/^light\./, "")
    .split("_")
    .filter((word) => word !== "main" && word !== "lights");
  if (words.at(-1) === "room") return (words[0] ?? "LGT").slice(0, 3).toUpperCase();
  return (words.at(-1) ?? "LGT").slice(0, 3).toUpperCase();
};

const smartHomeBackLines = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
): string[] => {
  const status = state.smartHomeStatus;
  const startLabel = sceneLabel(config.startSceneId);
  const checkingStart =
    state.smartHomeAction?.result === "checking" &&
    state.smartHomeAction.sceneId === config.startSceneId;
  const lightsOff = Boolean(
    status && status.lights.length > 0 && status.lights.every((light) => light.currentState === "off"),
  );
  const statusLabel = checkingStart
    ? "CHECKING"
    : status?.matches
      ? `${startLabel} ACTIVE`
      : lightsOff
        ? "LIGHTS OFF"
        : status
          ? `${startLabel} CHANGED`
          : "--";
  const targetLevels =
    status?.lights
      .map((light) => `${lightCode(light.entityId)}${brightnessLevel(light.sceneBrightness)}`)
      .join(" ") ?? "--";
  const currentLevels =
    status?.lights
      .map(
        (light) =>
          `${lightCode(light.entityId)}${currentLightLevel(
            light.currentState,
            light.currentBrightness,
          )}`,
      )
      .join(" ") ?? "--";
  const action = state.smartHomeAction;
  const actionLabel = action
    ? action.result === "checking"
      ? `${sceneLabel(action.sceneId)} ...`
      : action.result === "activated"
        ? `${sceneLabel(action.sceneId)} ON`
        : action.result === "lightsOff"
          ? "LIGHTS OFF"
          : `${sceneLabel(action.sceneId)} FAILED`
    : "--";
  return [
    "SMART HOME",
    `START ${startLabel}`,
    `STATUS ${statusLabel}`,
    `TARGET ${targetLevels}`,
    `NOW ${currentLevels}`,
    `DIAL ${sceneLabel(config.dialSceneId)}`,
    `LAST ${actionLabel}`,
  ];
};

const backLines = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): string[] => {
  const status = state.status;
  const system = state.system;
  const snapshot = system?.snapshot;
  if (state.backPage === 0) {
    const age = status ? `${Math.round(ageMs(state.statusReceivedAtMs, nowMs) / 1000)}s` : "--";
    const today = state.summary
      ? `DAY ${PICKUP_REAR_LABEL} ${summaryCount(state.summary.interactionsToday)} MSGS ${summaryCount(state.summary.messagesToday)}`
      : `DAY ${PICKUP_REAR_LABEL} -- MSGS --`;
    const breakdown = state.summary?.breakdownToday;
    if (breakdown) {
      return [
        today,
        `NO DIAL ${summaryCount(breakdown.noSelection)} WRONG ${summaryCount(breakdown.wrongNumberAttempts)}`,
        `LEFT ${summaryCount(breakdown.messagesLeft)} LISTEN ${summaryCount(breakdown.messagePlaybackStarts)}`,
        `INSTR ${summaryCount(breakdown.instructionPlaybackStarts)}`,
        `STATE ${status?.state ?? "--"} AGE ${age}`,
        `QUESTION ${shortId(status?.currentQuestionId)} MESSAGE ${shortId(status?.currentMessageId)}`,
        `ERROR ${status?.lastError ?? "CLEAR"} VIEW ${state.idleMode.toUpperCase()}`,
      ];
    }
    return [
      today,
      `STATE ${status?.state ?? "--"}`,
      `AGE ${age}`,
      `VIEW ${state.idleMode.toUpperCase()}`,
      `QUESTION ${shortId(status?.currentQuestionId)}`,
      `MESSAGE ${shortId(status?.currentMessageId)}`,
      `ERROR ${status?.lastError ?? "CLEAR"}`,
    ];
  }
  if (state.backPage === 2) {
    const network = snapshot?.networks?.[0];
    return [
      "NETWORK",
      `TAILSCALE ${snapshot?.tailscale?.connected == null ? "--" : snapshot.tailscale.connected ? "UP" : "DOWN"}`,
      `HOST ${snapshot?.tailscale?.hostname ?? "--"}`,
      `PEERS ${snapshot?.tailscale?.peerCount ?? "--"}`,
      `IFACE ${network?.interface ?? "--"}`,
      `TELEM ${system ? Math.round(ageMs(state.systemReceivedAtMs, nowMs) / 1000) : "--"}s`,
      `BUSY CLOUD ${state.cloudConnected ? "UP" : "DOWN"}`,
    ];
  }
  return smartHomeBackLines(state, config);
};

const compactCount = (count: number): string => (count > 999 ? "999+" : String(count));

const summaryCount = (count: number | undefined): string =>
  count === undefined ? "--" : compactCount(count);

const idleModePresentation = (
  mode: IdleMode,
  dark: boolean,
): FrontPresentation => {
  const label =
    mode === "weatherClock"
      ? "WX+CLOCK"
      : mode === "telephone"
        ? "BOOTH"
        : mode.toUpperCase();
  return {
    elements: [
      frontBackground(
        dark
          ? [COLORS.trueBlack, COLORS.trueBlack]
          : [COLORS.blueDark, COLORS.cyanDark],
      ),
      frontText("front-mode-title", "MODE", 36, 1, "tiny", COLORS.ice, "top_mid"),
      frontText(
        "front-mode-value",
        label,
        36,
        10,
        label.length > 7 ? "condensed" : "large",
        dark ? COLORS.cyan : COLORS.white,
      ),
    ],
  };
};

const sceneAnnouncementPresentation = (
  announcement: SceneAnnouncement,
  dark: boolean,
): FrontPresentation => {
  const goodNight = announcement.label === "GOOD NIGHT";
  const accent = goodNight ? COLORS.violet : COLORS.amber;
  const accentDark = goodNight ? COLORS.violetDark : COLORS.amberDark;
  const sweepWidth = [18, 44, 72][announcement.phase] ?? 72;
  const checkSegments: readonly (readonly [number, number])[] = [
    [5, 8],
    [7, 10],
    [9, 8],
    [11, 6],
    [13, 4],
  ];
  const visibleSegments = announcement.phase === 0 ? 1 : announcement.phase === 1 ? 3 : 5;
  return {
    elements: [
      frontBackground(
        dark ? [COLORS.trueBlack, COLORS.trueBlack] : [COLORS.slateDark, accentDark],
      ),
      frontRectangle("front-scene-sweep", 0, 0, sweepWidth, 16, accentDark),
      ...checkSegments
        .slice(0, visibleSegments)
        .map(([x, y], index) =>
          frontRectangle(`front-scene-check-${index}`, x, y, 3, 2, accent),
        ),
      frontText("front-scene-title", "SCENE", 45, 1, "tiny", COLORS.ice, "top_mid"),
      frontText(
        "front-scene-value",
        announcement.label,
        45,
        10,
        announcement.label.length > 7 ? "condensed" : "large",
        COLORS.white,
      ),
    ],
  };
};

const summaryLabelFont = (label: string): TextElement["font"] =>
  label.length > 7 ? "condensed" : label.length > 5 ? "small" : "normal";

const summaryCard = (
  label: string,
  period: "DAY" | "ALL",
  rawCount: number | undefined,
  background: Gradient,
  accent: string,
): {
  label: string;
  period: "DAY" | "ALL";
  count: string;
  background: Gradient;
  accent: string;
} => ({
  label,
  period,
  count: summaryCount(rawCount),
  background,
  accent,
});

const summaryFrameCard = (
  frame: SummaryFrontFrame,
  summary: MonitorSummary | null,
): {
  label: string;
  period: "DAY" | "ALL";
  count: string;
  background: Gradient;
  accent: string;
} => {
  switch (frame) {
    case "interactionsToday":
      return summaryCard(
        PICKUP_FRONT_LABEL,
        "DAY",
        summary?.interactionsToday,
        [COLORS.blueDark, COLORS.cyanDark],
        COLORS.cyan,
      );
    case "messagesToday":
      return summaryCard(
        "MSGS",
        "DAY",
        summary?.messagesToday,
        [COLORS.violetDark, COLORS.violet],
        COLORS.violet,
      );
    case "interactionsTotal":
      return summaryCard(
        PICKUP_FRONT_LABEL,
        "ALL",
        summary?.interactionsTotal,
        [COLORS.blueDark, COLORS.cyanDark],
        COLORS.cyan,
      );
    case "messagesTotal":
      return summaryCard(
        "MSGS",
        "ALL",
        summary?.messagesTotal,
        [COLORS.violetDark, COLORS.violet],
        COLORS.violet,
      );
    case "messagePlaybackStartsTotal":
      return summaryCard(
        "LISTEN",
        "ALL",
        summary?.messagePlaybackStartsTotal,
        [COLORS.blueDark, COLORS.cyanDark],
        COLORS.cyan,
      );
    case "noSelectionToday":
      return summaryCard(
        "NO DIAL",
        "DAY",
        summary?.breakdownToday?.noSelection,
        [COLORS.amberDark, COLORS.amber],
        COLORS.amber,
      );
    case "wrongNumberAttemptsToday":
      return summaryCard(
        "WRONG",
        "DAY",
        summary?.breakdownToday?.wrongNumberAttempts,
        [COLORS.redDark, COLORS.red],
        COLORS.red,
      );
    case "messagesLeftToday":
      return summaryCard(
        "LEFT",
        "DAY",
        summary?.breakdownToday?.messagesLeft,
        [COLORS.violetDark, COLORS.violet],
        COLORS.violet,
      );
    case "messagePlaybackStartsToday":
      return summaryCard(
        "LISTEN",
        "DAY",
        summary?.breakdownToday?.messagePlaybackStarts,
        [COLORS.blueDark, COLORS.cyanDark],
        COLORS.cyan,
      );
    case "instructionPlaybackStartsToday":
      return summaryCard(
        "INSTR",
        "DAY",
        summary?.breakdownToday?.instructionPlaybackStarts,
        [COLORS.slateDark, COLORS.slate],
        COLORS.yellow,
      );
  }
};

const summaryPresentation = (
  frame: SummaryFrontFrame,
  summary: MonitorSummary | null,
  dark: boolean,
): FrontPresentation => {
  const { label, period, count, background, accent } = summaryFrameCard(frame, summary);
  const themedBackground: Gradient = dark
    ? [COLORS.trueBlack, COLORS.trueBlack]
    : background;
  return {
    elements: [
      frontBackground(themedBackground),
      ...boothArtElements("front-booth", "idle"),
      frontRectangle(
        "front-count-badge",
        53,
        0,
        19,
        16,
        dark ? COLORS.trueBlack : accent,
      ),
      frontText(
        "front-count-label",
        label,
        18,
        1,
        summaryLabelFont(label),
        dark ? accent : COLORS.white,
        "top_left",
      ),
      frontText(
        "front-count-period",
        period,
        18,
        10,
        "tiny",
        dark ? COLORS.ice : COLORS.white,
        "top_left",
      ),
      frontText(
        "front-count-value",
        count,
        62.5,
        8,
        count.length > 3 ? "small" : count.length > 2 ? "condensed" : "large",
        dark ? accent : COLORS.black,
        "center",
      ),
    ],
  };
};

const vitalCardElements = (
  label: string,
  detail: string,
  background: Gradient,
  accent: string,
  dark: boolean,
): DisplayElement[] => [
  frontBackground(dark ? [COLORS.trueBlack, COLORS.trueBlack] : background),
  ...boothArtElements("front-booth", "idle"),
  frontRectangle("front-vital-badge", 53, 0, 19, 16, dark ? COLORS.trueBlack : accent),
  frontText(
    "front-vital-label",
    label,
    18,
    1,
    summaryLabelFont(label),
    dark ? accent : COLORS.white,
    "top_left",
  ),
  frontText(
    "front-vital-detail",
    detail,
    18,
    10,
    "tiny",
    dark ? COLORS.ice : COLORS.white,
    "top_left",
  ),
];

const fanLevelMeterElements = (
  ratio: number,
  activeColor: string,
  trackColor: string,
): RectangleElement[] => {
  const bars = [
    [55, 10, 3, 3],
    [59, 8, 3, 5],
    [63, 5, 3, 8],
    [67, 2, 3, 11],
  ] as const;
  const step = fanLevelStep(ratio);
  return bars.map(([x, y, width, height], index) =>
    frontRectangle(
      `front-fan-level-${index}`,
      x,
      y,
      width,
      height,
      index < step ? activeColor : trackColor,
    ),
  );
};

const fanVitalPresentation = (fan: FanCoolingPresentation, dark: boolean): FrontPresentation => {
  const meterActiveColor = dark ? COLORS.cyan : COLORS.black;
  const meterTrackColor = dark ? COLORS.cyanDark : COLORS.cyanMuted;
  return {
    elements: [
      ...vitalCardElements("FAN", fan.label, [COLORS.blueDark, COLORS.cyanDark], COLORS.cyan, dark),
      ...fanLevelMeterElements(fan.ratio, meterActiveColor, meterTrackColor),
    ],
  };
};

const numericVitalPresentation = (
  label: string,
  detail: string,
  value: string,
  background: Gradient,
  accent: string,
  dark: boolean,
  degree: boolean,
): FrontPresentation => {
  const valueColor = dark ? accent : COLORS.black;
  const valueCenter = degree ? 61 : 62.5;
  const degreeX = Math.min(68, Math.round(valueCenter + value.length * 3));
  return {
    elements: [
      ...vitalCardElements(label, detail, background, accent, dark),
      frontText(
        "front-vital-value",
        value,
        valueCenter,
        8,
        value.length > 3 ? "small" : value.length > 2 ? "condensed" : "large",
        valueColor,
        "center",
      ),
      ...(degree ? [degreeElement("front-vital-degree", degreeX, 3, valueColor)] : []),
    ],
  };
};

const vitalPresentation = (
  frame: Extract<
    FrontFrame,
    "fanCooling" | "piCpuTemperature" | "routerBatteryCharge" | "routerBatteryTemperature"
  >,
  state: MonitorState,
  dark: boolean,
): FrontPresentation => {
  const snapshot = state.system?.snapshot;
  const battery = state.routerTelemetry?.latestSnapshot?.battery;
  switch (frame) {
    case "fanCooling":
      return fanVitalPresentation(
        fanCoolingPresentation(snapshot?.fan) ?? { ratio: 0, label: "OFF" },
        dark,
      );
    case "piCpuTemperature":
      return numericVitalPresentation(
        "PI",
        "CPU TEMP",
        snapshot?.temperatureCelsius == null
          ? "--"
          : String(Math.round(snapshot.temperatureCelsius)),
        [COLORS.violetDark, COLORS.slate],
        COLORS.ice,
        dark,
        true,
      );
    case "routerBatteryCharge":
      return numericVitalPresentation(
        "BATTERY",
        "ROUTER",
        battery?.chargePercent == null ? "--" : `${Math.round(battery.chargePercent)}%`,
        [COLORS.slateDark, COLORS.slate],
        COLORS.yellow,
        dark,
        false,
      );
    case "routerBatteryTemperature":
      return numericVitalPresentation(
        "BATTERY",
        "ROUTER",
        battery?.temperatureCelsius == null ? "--" : String(Math.round(battery.temperatureCelsius)),
        [COLORS.amberDark, COLORS.slate],
        COLORS.amber,
        dark,
        true,
      );
  }
};

const clockPresentation = (
  timeZone: string,
  nowMs: number,
  dark: boolean,
): FrontPresentation => {
  const date = new Date(nowMs);
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "short",
  })
    .format(date)
    .toUpperCase();
  const dayOfMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    day: "2-digit",
  }).format(date);
  const dateLabel = `${month} ${dayOfMonth}`;
  const weekday = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
  })
    .format(date)
    .toUpperCase();
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return {
    elements: [
      frontBackground(
        dark
          ? [COLORS.trueBlack, COLORS.trueBlack]
          : [COLORS.blueDark, COLORS.cyanDark],
      ),
      frontRectangle(
        "front-clock-badge",
        44,
        0,
        28,
        16,
        dark ? COLORS.trueBlack : COLORS.cyan,
      ),
      frontRectangle(
        "front-clock-divider",
        44,
        0,
        1,
        16,
        dark ? COLORS.cyanDark : COLORS.blueDark,
      ),
      frontText(
        "front-clock-time",
        time,
        22,
        8,
        "large",
        dark ? COLORS.ice : COLORS.white,
      ),
      frontText(
        "front-clock-weekday",
        weekday,
        58,
        1,
        "tiny",
        dark ? COLORS.cyan : COLORS.black,
        "top_mid",
      ),
      frontText(
        "front-clock-date",
        dateLabel,
        58,
        10,
        "small",
        dark ? COLORS.cyan : COLORS.black,
      ),
    ],
  };
};

interface WeatherPalette {
  background: Gradient;
  accent: string;
  accentText: string;
}

const weatherPalette = (condition: WeatherCondition): WeatherPalette => {
  if (condition === "sunny" || condition === "partlycloudy") {
    return {
      background: [COLORS.blueDark, COLORS.cyanDark],
      accent: "#DFAF38FF",
      accentText: "#2A1B00FF",
    };
  }
  if (condition === "clear-night") {
    return {
      background: [COLORS.slateDark, COLORS.blueDark],
      accent: "#5AA3C2FF",
      accentText: "#06131DFF",
    };
  }
  if (
    condition === "rainy" ||
    condition === "pouring" ||
    condition === "lightning-rainy"
  ) {
    return {
      background: [COLORS.blueDark, COLORS.cyanDark],
      accent: "#278EB7FF",
      accentText: "#03151EFF",
    };
  }
  if (condition === "snowy" || condition === "snowy-rainy" || condition === "hail") {
    return {
      background: [COLORS.slateDark, COLORS.slate],
      accent: "#8AB6CCFF",
      accentText: COLORS.slateDark,
    };
  }
  if (condition === "lightning") {
    return {
      background: [COLORS.violetDark, COLORS.slateDark],
      accent: COLORS.yellow,
      accentText: "#2A1B00FF",
    };
  }
  if (condition === "exceptional") {
    return {
      background: [COLORS.redDark, COLORS.red],
      accent: COLORS.red,
      accentText: COLORS.white,
    };
  }
  return {
    background: [COLORS.slateDark, COLORS.slate],
    accent: "#6F8FA3FF",
    accentText: COLORS.white,
  };
};

interface StandardWeatherDetail {
  kind: "standard";
  top: string;
  bottom: string;
  degree: boolean;
}

interface HighLowWeatherDetail {
  kind: "highLow";
  high: string;
  low: string;
}

type WeatherDetail = StandardWeatherDetail | HighLowWeatherDetail;

const roundedTemperature = (temperature: number): string => String(Math.round(temperature));

const weatherDetail = (weather: WeatherSnapshot): WeatherDetail => {
  if (
    weather.precipitationProbability !== null &&
    weather.precipitationProbability >= 30
  ) {
    return {
      kind: "standard",
      top:
        weather.precipitationKind === "snow"
          ? "SNOW"
          : weather.precipitationKind === "mix"
            ? "MIX"
            : "RAIN",
      bottom: `${Math.round(weather.precipitationProbability)}%`,
      degree: false,
    };
  }
  if (
    weather.feelsLikeCelsius !== null &&
    Math.abs(weather.feelsLikeCelsius - weather.temperatureCelsius) >= 3
  ) {
    return {
      kind: "standard",
      top: "FEELS",
      bottom: roundedTemperature(weather.feelsLikeCelsius),
      degree: true,
    };
  }
  if (weather.highCelsius !== null && weather.lowCelsius !== null) {
    return {
      kind: "highLow",
      high: roundedTemperature(weather.highCelsius),
      low: roundedTemperature(weather.lowCelsius),
    };
  }
  if (weather.humidityPercent !== null) {
    return {
      kind: "standard",
      top: "HUMID",
      bottom: `${Math.round(weather.humidityPercent)}%`,
      degree: false,
    };
  }
  return { kind: "standard", top: "NOW", bottom: "--", degree: false };
};

const weatherPresentation = (
  weather: WeatherSnapshot,
  dark: boolean,
): FrontPresentation => {
  const palette = weatherPalette(weather.condition);
  const themedPalette: WeatherPalette = dark
    ? {
        background: [COLORS.trueBlack, COLORS.trueBlack],
        accent: COLORS.trueBlack,
        accentText: palette.accent,
      }
    : palette;
  const temperature = roundedTemperature(weather.temperatureCelsius);
  const temperatureCenter = 30;
  const temperatureDegreeX = Math.min(
    45,
    Math.round(temperatureCenter + temperature.length * 4.5 + 1),
  );
  const detail = weatherDetail(weather);
  const detailElements =
    detail.kind === "highLow"
      ? [
          frontText(
            "front-weather-high-label",
            "H",
            53,
            1,
            "tiny",
            themedPalette.accentText,
            "top_left",
          ),
          frontText(
            "front-weather-high-value",
            detail.high,
            70,
            0,
            "small",
            themedPalette.accentText,
            "top_right",
          ),
          frontText(
            "front-weather-low-label",
            "L",
            53,
            10,
            "tiny",
            themedPalette.accentText,
            "top_left",
          ),
          frontText(
            "front-weather-low-value",
            detail.low,
            70,
            8,
            "small",
            themedPalette.accentText,
            "top_right",
          ),
        ]
      : [
          frontText(
            "front-weather-detail-label",
            detail.top,
            61,
            1,
            "tiny",
            themedPalette.accentText,
            "top_mid",
          ),
          frontText(
            "front-weather-detail-value",
            detail.bottom,
            detail.degree
              ? detail.bottom.length > 2
                ? 58
                : 59.5
              : 61,
            10,
            "small",
            themedPalette.accentText,
            "center",
          ),
          ...(detail.degree
            ? [
                degreeElement(
                  "front-weather-detail-degree",
                  64,
                  8,
                  themedPalette.accentText,
                ),
              ]
            : []),
        ];
  return {
    elements: [
      frontBackground(themedPalette.background),
      ...weatherIconElements("front-weather", weather.condition),
      frontText(
        "front-weather-temperature",
        temperature,
        temperatureCenter,
        8,
        "large",
        dark ? palette.accent : COLORS.white,
        "center",
      ),
      degreeElement(
        "front-weather-degree",
        temperatureDegreeX,
        3,
        dark ? palette.accent : COLORS.white,
      ),
      frontRectangle("front-weather-badge", 50, 0, 22, 16, themedPalette.accent),
      ...detailElements,
    ],
  };
};

const idlePresentation = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): FrontPresentation => {
  const dark = state.weather?.sunState === "below_horizon";
  if (state.sceneAnnouncement) {
    return sceneAnnouncementPresentation(state.sceneAnnouncement, dark);
  }
  if (state.idleModeAnnouncement) {
    return idleModePresentation(state.idleModeAnnouncement, dark);
  }
  const frames = availableFrontFrames(state, config, nowMs);
  const frame = frames.includes(state.frontFrame)
    ? state.frontFrame
    : (frames[0] ?? DEFAULT_FRONT_FRAME);
  if (frame === "clock") return clockPresentation(config.timeZone, nowMs, dark);
  if (frame === "weather") {
    return state.weather
      ? weatherPresentation(state.weather, dark)
      : summaryPresentation(DEFAULT_FRONT_FRAME, state.summary, dark);
  }
  if (
    frame === "fanCooling" ||
    frame === "piCpuTemperature" ||
    frame === "routerBatteryCharge" ||
    frame === "routerBatteryTemperature"
  ) {
    return vitalPresentation(frame, state, dark);
  }
  return summaryPresentation(frame, state.summary, dark);
};

export const renderMonitor = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): MonitorRender => {
  const offline = statusIsStale(state.statusReceivedAtMs, nowMs, config.statusStaleAfterMs);
  const boothState = state.status?.state;
  const health = healthPresentation(state, nowMs, config.systemStaleAfterMs);
  const frontView: FrontPresentation = offline
    ? warningPresentation("OFFLINE", [COLORS.redDark, COLORS.red], COLORS.red, COLORS.red)
    : boothState && boothState !== "idle"
      ? statePresentation(boothState)
      : (health.view ?? idlePresentation(state, config, nowMs));
  const frontElements = stableFrontElements(frontView.elements);
  const backView: BackPresentation =
    state.backPage === 1
      ? systemVitalsBackPresentation(state, config, nowMs)
      : {
          elements: backLines(state, config, nowMs).map((line, index) =>
            backText(
              `back-line-${index}`,
              line,
              2,
              index === 0 ? 1 : 12 + (index - 1) * 11,
              index === 0 ? "bold" : "small",
              COLORS.white,
              "top_left",
              156,
            ),
          ),
        };
  const backElements = stableBackElements(backView.elements);
  const frontSignature = JSON.stringify({
    indicator: frontView.indicator ?? null,
    elements: frontElements,
  });
  const backSignature = JSON.stringify(backElements);
  const payload: DisplayDrawParams = {
    application_name: config.applicationName,
    priority: config.displayPriority,
    ...(frontView.indicator ? { led_notification_color: frontView.indicator } : {}),
    elements: [...frontElements, ...backElements],
  };
  return {
    payload,
    frontSignature,
    backSignature,
    signature: JSON.stringify(payload),
    alertKind:
      offline || health.offline
        ? "offline"
        : boothState === "error"
          ? "error"
          : health.severity === "crit"
            ? "critical"
            : null,
  };
};
