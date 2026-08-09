import type { DisplayDrawParams, RectangleElement, TextElement } from "@busy-app/busy-lib";
import {
  SYSTEM_HEALTH_THRESHOLDS,
  activeThrottlingLabels,
  aggregateSystemHealthSeverity,
} from "./health.js";
import type { SystemHealthSeverity } from "./health.js";
import type { MonitorConfig } from "./config.js";
import type {
  BoothState,
  BoothStatus,
  BoothSystemSnapshotEnvelope,
  MonitorSummary,
} from "./schemas.js";

export type FrontFrame = "state" | "calls" | "messages" | "health";
export type BackPage = 0 | 1 | 2;

export interface MonitorState {
  status: BoothStatus | null;
  statusReceivedAtMs: number | null;
  system: BoothSystemSnapshotEnvelope | null;
  systemReceivedAtMs: number | null;
  summary: MonitorSummary | null;
  frontFrame: FrontFrame;
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

const COLORS = {
  blue: "#005EBFFF",
  blueDark: "#003B7AFF",
  amber: "#FAAB00FF",
  amberDark: "#865B00FF",
  cyan: "#00C8FFFF",
  cyanDark: "#006A85FF",
  red: "#FB2C36FF",
  redDark: "#7A1118FF",
  violet: "#A855F7FF",
  violetDark: "#4C1D95FF",
  green: "#00C16AFF",
  greenDark: "#006638FF",
  white: "#FFFFFFFF",
  transparent: "#00000000",
} as const;

type Gradient = readonly [string, string];

interface FrontPresentation {
  readonly label: string;
  readonly background: Gradient;
  readonly indicator?: string;
}

const sanitize = (input: string, maximum: number): string =>
  input
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

const statePresentation = (state: BoothState): FrontPresentation => {
  if (state === "idle") {
    return { label: "READY", background: [COLORS.blueDark, COLORS.blue] };
  }
  if (state === "dialTone" || state === "dialing") {
    return { label: "CALLING", background: [COLORS.amberDark, COLORS.amber] };
  }
  if (
    state === "playingQuestion" ||
    state === "playingMessage" ||
    state === "playingInstructions"
  ) {
    return { label: "PLAYING", background: [COLORS.cyanDark, COLORS.cyan] };
  }
  if (state === "beep" || state === "recording") {
    return {
      label: "RECORDING",
      background: [COLORS.redDark, COLORS.red],
      indicator: COLORS.red,
    };
  }
  if (state === "uploading") {
    return { label: "SENDING", background: [COLORS.violetDark, COLORS.violet] };
  }
  if (state === "callUnavailable") {
    return {
      label: "UNAVAILABLE",
      background: [COLORS.amberDark, COLORS.amber],
      indicator: COLORS.amber,
    };
  }
  return {
    label: "ERROR",
    background: [COLORS.redDark, COLORS.red],
    indicator: COLORS.red,
  };
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

const healthPresentation = (
  state: MonitorState,
  nowMs: number,
  systemStaleAfterMs: number,
): FrontPresentation & { severity: SystemHealthSeverity } => {
  if (
    !state.system ||
    ageMs(state.systemReceivedAtMs, nowMs) > systemStaleAfterMs ||
    !state.cloudConnected
  ) {
    return {
      label: "OFFLINE",
      background: [COLORS.redDark, COLORS.red],
      indicator: COLORS.red,
      severity: "crit",
    };
  }
  const snapshot = state.system.snapshot;
  const throttling = activeThrottlingLabels(snapshot.throttling);
  if (
    snapshot.temperatureCelsius != null &&
    snapshot.temperatureCelsius >= SYSTEM_HEALTH_THRESHOLDS.temperatureCriticalCelsius
  ) {
    return {
      label: "HOT",
      background: [COLORS.redDark, COLORS.red],
      indicator: COLORS.red,
      severity: "crit",
    };
  }
  const severity = aggregateSystemHealthSeverity(snapshot);
  if (severity === "crit") {
    return {
      label: "SYSTEM CRIT",
      background: [COLORS.redDark, COLORS.red],
      indicator: COLORS.red,
      severity,
    };
  }
  if (throttling.length > 0) {
    return {
      label: "THROTTLED",
      background: [COLORS.amberDark, COLORS.amber],
      indicator: COLORS.amber,
      severity: "warn",
    };
  }
  if (severity === "warn") {
    return {
      label: "SYSTEM WARN",
      background: [COLORS.amberDark, COLORS.amber],
      indicator: COLORS.amber,
      severity,
    };
  }
  return {
    label: "SYSTEM OK",
    background: [COLORS.greenDark, COLORS.green],
    severity,
  };
};

const text = (
  id: string,
  display: "front" | "back",
  value: string,
  y: number,
  font: TextElement["font"],
  color: string = COLORS.white,
): TextElement => ({
  id,
  type: "text",
  x: display === "front" ? 36 : 2,
  y,
  display,
  align: display === "front" ? "center" : "top_left",
  text: sanitize(value, display === "front" ? 18 : 36),
  font,
  color,
  width: display === "front" ? 72 : 156,
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

const shortId = (value: string | null | undefined): string => (value ? value.slice(0, 8) : "--");

const percent = (used: number | null | undefined, total: number | null | undefined): string =>
  typeof used === "number" && typeof total === "number" && total > 0
    ? `${Math.round((used / total) * 100)}%`
    : "--";

const backLines = (state: MonitorState, nowMs: number): string[] => {
  const status = state.status;
  const system = state.system;
  const snapshot = system?.snapshot;
  if (state.backPage === 0) {
    const today = state.summary
      ? `CALLS ${state.summary.callsToday} MSGS ${state.summary.messagesToday}`
      : "CALL";
    return [
      today,
      `STATE ${status?.state ?? "--"}`,
      `AGE ${status ? Math.round(ageMs(state.statusReceivedAtMs, nowMs) / 1000) : "--"}s`,
      `MODE ${status?.runtimeMode ?? snapshot?.runtimeMode ?? "--"}`,
      `QUESTION ${shortId(status?.currentQuestionId)}`,
      `MESSAGE ${shortId(status?.currentMessageId)}`,
      `ERROR ${status?.lastError ?? "CLEAR"}`,
    ];
  }
  if (state.backPage === 1) {
    const memory = snapshot?.memory;
    const disk = snapshot?.disks?.[0];
    return [
      "SYSTEM",
      `CLIENT ${system?.version ?? "--"}`,
      `TEMP ${snapshot?.temperatureCelsius?.toFixed(1) ?? "--"} C`,
      `CPU ${snapshot?.cpu?.usageRatio != null ? `${Math.round(snapshot.cpu.usageRatio * 100)}%` : "--"}`,
      `MEM ${percent(memory?.usedBytes, memory?.totalBytes)}`,
      `DISK ${disk ? percent(disk.totalBytes - disk.availableBytes, disk.totalBytes) : "--"}`,
      `UP ${snapshot?.uptimeSeconds != null ? `${Math.floor(snapshot.uptimeSeconds / 60)}m` : "--"}`,
    ];
  }
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
};

const compactCount = (count: number): string => (count > 999 ? "999+" : String(count));

const summaryPresentation = (
  frame: Extract<FrontFrame, "calls" | "messages">,
  summary: MonitorSummary,
): FrontPresentation =>
  frame === "calls"
    ? {
        label: `CALLS ${compactCount(summary.callsToday)}`,
        background: [COLORS.blueDark, COLORS.cyanDark],
      }
    : {
        label: `MSGS ${compactCount(summary.messagesToday)}`,
        background: [COLORS.violetDark, COLORS.violet],
      };

export const renderMonitor = (
  state: MonitorState,
  config: Extract<MonitorConfig, { enabled: true }>,
  nowMs: number,
): MonitorRender => {
  const offline = statusIsStale(state.statusReceivedAtMs, nowMs, config.statusStaleAfterMs);
  const stateView = statePresentation(state.status?.state ?? "error");
  const healthView = healthPresentation(state, nowMs, config.systemStaleAfterMs);
  const frontView: FrontPresentation = offline
    ? {
        label: "OFFLINE",
        background: [COLORS.redDark, COLORS.red],
        indicator: COLORS.red,
      }
    : state.status?.state !== "idle"
      ? stateView
      : healthView.severity !== "ok" || state.frontFrame === "health"
        ? healthView
        : state.summary && (state.frontFrame === "calls" || state.frontFrame === "messages")
          ? summaryPresentation(state.frontFrame, state.summary)
          : stateView;
  const frontElements = [
    frontBackground(frontView.background),
    text("front-label", "front", frontView.label, 8, "large", COLORS.white),
  ];
  const lines = backLines(state, nowMs);
  const backElements = Array.from({ length: 7 }, (_, index) =>
    text(
      `back-line-${index}`,
      "back",
      lines[index] ?? "",
      index === 0 ? 1 : 12 + (index - 1) * 11,
      index === 0 ? "bold" : "small",
    ),
  );
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
      offline || healthView.label === "OFFLINE"
        ? "offline"
        : state.status?.state === "error"
          ? "error"
          : healthView.severity === "crit"
            ? "critical"
            : null,
  };
};
