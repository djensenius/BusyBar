import { aggregateSystemHealthSeverity } from "./health.js";
import type { HomeAssistantSceneClient } from "./home-assistant-client.js";
import type {
  FluxHausDeviceId,
  FluxHausSnapshot,
} from "./fluxhaus-client.js";
import { log } from "./logger.js";
import type { BusyBarDeviceClient } from "./busy-client.js";
import type { MonitorConfig } from "./config.js";
import type { BusyBarInputEvent, BusyBarInputStreamHandle } from "./input-stream.js";
import { startBusyBarInputStream } from "./input-stream.js";
import type {
  BackPage,
  CompletionAlert,
  IdleMode,
  MonitorState,
  SceneAnnouncement,
} from "./renderer.js";
import {
  availableFrontFrames,
  DEFAULT_FRONT_FRAME,
  isBetweenExhibitions,
  renderMonitor,
} from "./renderer.js";
import type {
  BoothStatus,
  BoothSystemSnapshotEnvelope,
  MonitorSummary,
  RouterTelemetryEnvelope,
} from "./schemas.js";
import type { WeatherSnapshot } from "./weather-client.js";

const BACK_PAGE_COUNT = 4;
const SMART_HOME_POLL_INTERVAL_MS = 30_000;
const SMART_HOME_BACK_DISPLAY_MS = 4_000;
const COMPLETION_ALERT_MS = 10_000;
const COMPLETION_EXPIRY_MS = 5 * 60_000;
const COMPLETION_DEVICE_ORDER: readonly FluxHausDeviceId[] = [
  "washer",
  "dryer",
  "dishwasher",
  "broombot",
  "mopbot",
];

export const nextBackPage = (page: BackPage, direction: number): BackPage =>
  ((((page + direction) % BACK_PAGE_COUNT) + BACK_PAGE_COUNT) % BACK_PAGE_COUNT) as BackPage;

const nextFrontFrame = (
  current: MonitorState["frontFrame"],
  frames: readonly MonitorState["frontFrame"][],
  currentIndex: number,
): { frame: MonitorState["frontFrame"]; index: number } => {
  if (frames.length === 0) return { frame: DEFAULT_FRONT_FRAME, index: 0 };
  const matchingIndex =
    frames[currentIndex] === current ? currentIndex : Math.max(0, frames.indexOf(current));
  const index = (matchingIndex + 1) % frames.length;
  return { frame: frames[index] ?? frames[0] ?? DEFAULT_FRONT_FRAME, index };
};

const IDLE_MODES: readonly IdleMode[] = [
  "weather",
  "clock",
  "weatherClock",
  "telephone",
  "all",
];

export const nextIdleMode = (current: IdleMode, direction: number): IdleMode => {
  const index = IDLE_MODES.indexOf(current);
  const next = (((index + (direction > 0 ? 1 : -1)) % IDLE_MODES.length) +
    IDLE_MODES.length) %
    IDLE_MODES.length;
  return IDLE_MODES[next] ?? "all";
};

type BusyBarButton = Extract<BusyBarInputEvent, { kind: "button" }>["button"];

export const sceneIdForButton = (
  config: Extract<MonitorConfig, { enabled: true }>,
  button: BusyBarButton,
): string | null => {
  if (button === "START") return config.startSceneId;
  if (button === "OK") return config.dialSceneId;
  return null;
};

export interface SceneButtonAction {
  sceneId: string;
  turnOffLightIds: readonly string[];
}

export const sceneActionForButton = (
  config: Extract<MonitorConfig, { enabled: true }>,
  button: BusyBarButton,
): SceneButtonAction | null => {
  const sceneId = sceneIdForButton(config, button);
  if (!sceneId) return null;
  return {
    sceneId,
    turnOffLightIds: button === "START" ? config.startToggleLightIds : [],
  };
};

export const sceneAnnouncementLabel = (entityId: string): string =>
  entityId
    .replace(/^scene\./, "")
    .replace(/_/g, " ")
    .toUpperCase()
    .slice(0, 12);

export const desiredDisplayBrightness = (
  weather: WeatherSnapshot | null,
  timeZone: string,
  lateNightBrightness: number,
  nowMs = Date.now(),
): number | "auto" => {
  if (weather?.sunState !== "below_horizon") return "auto";
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(nowMs)),
  );
  return hour >= 23 || hour < 12 ? lateNightBrightness : "auto";
};

export class Monitor {
  readonly #config: Extract<MonitorConfig, { enabled: true }>;
  readonly #client: BusyBarDeviceClient;
  readonly #homeAssistant: HomeAssistantSceneClient | null;
  #state: MonitorState = {
    status: null,
    statusReceivedAtMs: null,
    system: null,
    systemReceivedAtMs: null,
    routerTelemetry: null,
    routerTelemetryReceivedAtMs: null,
    summary: null,
    weather: null,
    weatherReceivedAtMs: null,
    fluxHaus: null,
    fluxHausReceivedAtMs: null,
    completionAlert: null,
    frontFrame: DEFAULT_FRONT_FRAME,
    idleMode: "all",
    idleModeAnnouncement: null,
    sceneAnnouncement: null,
    smartHomeStatus: null,
    smartHomeAction: null,
    backPage: 0,
    cloudConnected: false,
  };
  #renderTimer: NodeJS.Timeout | null = null;
  #freshnessTimer: NodeJS.Timeout | null = null;
  #rotationTimer: NodeJS.Timeout | null = null;
  #retryTimer: NodeJS.Timeout | null = null;
  #inputStream: BusyBarInputStreamHandle | null = null;
  #rendering = false;
  #renderQueued = false;
  #activeRender: Promise<void> | null = null;
  #retryAttempt = 0;
  #renderSignature: string | null = null;
  readonly #lastAlertAt: Record<"error" | "offline" | "critical", number> = {
    error: 0,
    offline: 0,
    critical: 0,
  };
  #stopped = false;
  #started = false;
  #stopPromise: Promise<void> | null = null;
  #currentAlertKind: "error" | "offline" | "critical" | null = null;
  #statusSourceAtMs: number | null = null;
  #statusSourceId: number | null = null;
  #statusSourceRepeatCount: number | null = null;
  #statusSourceSignature: string | null = null;
  #systemSourceAtMs: number | null = null;
  #systemSourceSignature: string | null = null;
  #routerTelemetrySourceAtMs: number | null = null;
  #routerTelemetrySourceSignature: string | null = null;
  #summarySourceAtMs: number | null = null;
  #fluxHausSourceAtMs: number | null = null;
  #fluxHausSourceSignature: string | null = null;
  #fluxHausInitialized = false;
  #frontFrameIndex = 0;
  readonly #completionQueue: CompletionAlert[] = [];
  #completionTimer: NodeJS.Timeout | null = null;
  #brightnessValue: number | "auto" | null = null;
  #brightnessUpdating = false;
  #brightnessQueued = false;
  #idleModeAnnouncementTimer: NodeJS.Timeout | null = null;
  #sceneAnnouncementTimer: NodeJS.Timeout | null = null;
  #smartHomePollTimer: NodeJS.Timeout | null = null;
  #backPageRestoreTimer: NodeJS.Timeout | null = null;
  #backPageBeforeSmartHome: BackPage | null = null;
  #smartHomeActionPending = false;
  #smartHomeRefreshing = false;
  #smartHomeRefreshQueued = false;

  constructor(
    config: Extract<MonitorConfig, { enabled: true }>,
    client: BusyBarDeviceClient,
    homeAssistant: HomeAssistantSceneClient | null = null,
  ) {
    this.#config = config;
    this.#client = client;
    this.#homeAssistant = homeAssistant;
  }

  async start(): Promise<void> {
    await this.#client.clear(this.#config.applicationName);
    if (this.#stopped) return;
    if (this.#config.localUrl && this.#config.localAccessKey) {
      this.#inputStream = startBusyBarInputStream({
        url: this.#config.localUrl,
        accessKey: this.#config.localAccessKey,
        onInput: (event) => this.#handleInput(event),
        onFrame: (byteLength, eventCount) => {
          log.debug({ byteLength, eventCount }, "BUSY Bar input frame received");
        },
        onStatus: (connected) => {
          log.info({ connected }, "BUSY Bar input stream state changed");
        },
        onError: (error) => {
          log.warn({ err: error }, "BUSY Bar input stream failed");
        },
      });
    } else {
      log.warn(
        "BUSY_BAR_LOCAL_URL and BUSY_BAR_LOCAL_ACCESS_KEY are not configured; input navigation is disabled",
      );
    }

    this.#started = true;
    this.#freshnessTimer = setInterval(() => {
      this.#scheduleRender();
      this.#scheduleBrightness();
      this.#showNextCompletion();
    }, 5_000);
    this.#freshnessTimer.unref();
    this.#rotationTimer = setInterval(() => {
      if (
        (this.#state.status?.state !== "idle" && !isBetweenExhibitions(this.#state, this.#config, Date.now())) ||
        this.#state.completionAlert
      ) return;
      const frames = availableFrontFrames(this.#state, this.#config, Date.now());
      const next = nextFrontFrame(this.#state.frontFrame, frames, this.#frontFrameIndex);
      this.#frontFrameIndex = next.index;
      this.#state = {
        ...this.#state,
        frontFrame: next.frame,
      };
      this.#scheduleRender();
    }, this.#config.frontRotationMs);
    this.#rotationTimer.unref();
    this.#state = { ...this.#state, cloudConnected: true };
    if (this.#config.startSceneId && this.#config.startToggleLightIds.length > 0) {
      this.#refreshSmartHomeStatus();
      this.#smartHomePollTimer = setInterval(() => {
        this.#refreshSmartHomeStatus();
      }, SMART_HOME_POLL_INTERVAL_MS);
      this.#smartHomePollTimer.unref();
    }
    this.#showNextCompletion();
    this.#scheduleRender();
    log.info("BUSY Bar monitor started");
  }

  updateStatus(status: BoothStatus, receivedAtMs = Date.now()): void {
    // Lifecycle is operator-controlled, not ordered by the booth timestamp.
    // A synthetic epoch response can end a recently observed active call.
    if (status.installationState !== undefined) {
      this.#state = {
        ...this.#state,
        installationState: status.installationState,
        installationStateReceivedAtMs: Math.min(receivedAtMs, Date.now()),
      };
      this.#scheduleRender();
    }
    if (
      status.isSynthetic === true ||
      (status.id === undefined && status.installationState !== undefined)
    ) {
      this.#state = { ...this.#state, status: null, statusReceivedAtMs: null };
      this.#statusSourceAtMs = null;
      this.#statusSourceId = null;
      this.#statusSourceRepeatCount = null;
      this.#statusSourceSignature = null;
      this.#scheduleRender();
      return;
    }
    const reportedAtMs = Date.parse(status.updatedAt);
    const sourceAtMs = Math.min(
      Number.isFinite(reportedAtMs) ? reportedAtMs : receivedAtMs,
      receivedAtMs,
      Date.now(),
    );
    const sourceId = status.id ?? null;
    const sourceRepeatCount = status.repeatCount ?? null;
    const sourceSignature = JSON.stringify(status);
    if (this.#statusSourceAtMs !== null) {
      if (sourceAtMs < this.#statusSourceAtMs) return;
      if (sourceAtMs === this.#statusSourceAtMs) {
        if (
          this.#statusSourceId !== null &&
          (sourceId === null || sourceId < this.#statusSourceId)
        ) {
          return;
        }
        if (sourceId === this.#statusSourceId) {
          if (sourceRepeatCount === null) {
            if (sourceSignature === this.#statusSourceSignature) return;
          }
          if (
            sourceRepeatCount !== null &&
            this.#statusSourceRepeatCount !== null &&
            sourceRepeatCount <= this.#statusSourceRepeatCount
          ) {
            return;
          }
        }
      }
    }
    const wasActive = this.#state.status !== null && this.#state.status.state !== "idle";
    const cappedReceivedAtMs = Math.min(receivedAtMs, Date.now());
    this.#statusSourceAtMs = sourceAtMs;
    this.#statusSourceId = sourceId;
    this.#statusSourceRepeatCount = sourceRepeatCount;
    this.#statusSourceSignature = sourceSignature;
    this.#state = {
      ...this.#state,
      status,
      statusReceivedAtMs: Math.max(this.#state.statusReceivedAtMs ?? 0, cappedReceivedAtMs),
      frontFrame: status.state === "idle" && wasActive ? DEFAULT_FRONT_FRAME : this.#state.frontFrame,
    };
    if (status.state === "idle" && wasActive) this.#frontFrameIndex = 0;
    this.#showNextCompletion();
    this.#scheduleRender();
  }

  updateSystem(system: BoothSystemSnapshotEnvelope, receivedAtMs = Date.now()): void {
    const reportedAtMs = Date.parse(system.receivedAt);
    const sourceAtMs = Math.min(
      Number.isFinite(reportedAtMs) ? reportedAtMs : receivedAtMs,
      receivedAtMs,
      Date.now(),
    );
    const sourceSignature = JSON.stringify(system);
    if (this.#systemSourceAtMs !== null && sourceAtMs < this.#systemSourceAtMs) return;
    if (sourceAtMs === this.#systemSourceAtMs && sourceSignature === this.#systemSourceSignature) {
      return;
    }
    const previousSeverity = aggregateSystemHealthSeverity(this.#state.system?.snapshot);
    const recovered =
      previousSeverity !== "ok" && aggregateSystemHealthSeverity(system.snapshot) === "ok";
    this.#systemSourceAtMs = sourceAtMs;
    this.#systemSourceSignature = sourceSignature;
    this.#state = {
      ...this.#state,
      system,
      systemReceivedAtMs: Math.min(receivedAtMs, Date.now()),
      frontFrame: recovered ? DEFAULT_FRONT_FRAME : this.#state.frontFrame,
    };
    if (recovered) this.#frontFrameIndex = 0;
    this.#showNextCompletion();
    this.#scheduleRender();
  }

  updateRouterTelemetry(routerTelemetry: RouterTelemetryEnvelope, receivedAtMs = Date.now()): void {
    const reportedAtMs = Date.parse(routerTelemetry.receivedAt ?? routerTelemetry.capturedAt ?? "");
    const sourceAtMs = Math.min(
      Number.isFinite(reportedAtMs) ? reportedAtMs : receivedAtMs,
      receivedAtMs,
      Date.now(),
    );
    const sourceSignature = JSON.stringify(routerTelemetry);
    if (this.#routerTelemetrySourceAtMs !== null && sourceAtMs < this.#routerTelemetrySourceAtMs) {
      return;
    }
    if (
      sourceAtMs === this.#routerTelemetrySourceAtMs &&
      sourceSignature === this.#routerTelemetrySourceSignature
    ) {
      return;
    }
    this.#routerTelemetrySourceAtMs = sourceAtMs;
    this.#routerTelemetrySourceSignature = sourceSignature;
    this.#state = {
      ...this.#state,
      routerTelemetry,
      routerTelemetryReceivedAtMs: Math.min(receivedAtMs, Date.now()),
    };
    this.#scheduleRender();
  }

  updateSummary(summary: MonitorSummary): void {
    const generatedAtMs = Date.parse(summary.generatedAt);
    const sourceAtMs = Math.min(
      Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
      Date.now(),
    );
    if (this.#summarySourceAtMs !== null && sourceAtMs < this.#summarySourceAtMs) return;
    this.#summarySourceAtMs = sourceAtMs;
    this.#state = { ...this.#state, summary };
    this.#scheduleRender();
  }

  updateWeather(weather: WeatherSnapshot, receivedAtMs = Date.now()): void {
    this.#state = {
      ...this.#state,
      weather,
      weatherReceivedAtMs: Math.min(receivedAtMs, Date.now()),
    };
    this.#scheduleBrightness();
    this.#scheduleRender();
  }

  updateFluxHaus(snapshot: FluxHausSnapshot, receivedAtMs = Date.now()): void {
    const generatedAtMs = Date.parse(snapshot.generatedAt);
    const sourceAtMs = Math.min(
      Number.isFinite(generatedAtMs) ? generatedAtMs : receivedAtMs,
      receivedAtMs,
      Date.now(),
    );
    const sourceSignature = JSON.stringify(snapshot);
    if (this.#fluxHausSourceAtMs !== null && sourceAtMs < this.#fluxHausSourceAtMs) return;
    if (
      sourceAtMs === this.#fluxHausSourceAtMs &&
      sourceSignature === this.#fluxHausSourceSignature
    ) {
      this.#state = {
        ...this.#state,
        fluxHausReceivedAtMs: Math.max(
          this.#state.fluxHausReceivedAtMs ?? 0,
          Math.min(receivedAtMs, Date.now()),
        ),
      };
      this.#showNextCompletion();
      this.#scheduleRender();
      return;
    }

    const previousReceivedAtMs = this.#state.fluxHausReceivedAtMs;
    const previousFresh =
      previousReceivedAtMs !== null &&
      receivedAtMs - previousReceivedAtMs <= (this.#config.fluxHaus?.staleAfterMs ?? 0);
    const previousById = new Map(
      (this.#state.fluxHaus?.devices ?? []).map((device) => [device.id, device]),
    );
    const nextById = new Map(snapshot.devices.map((device) => [device.id, device]));
    const completed = this.#fluxHausInitialized && previousFresh
      ? COMPLETION_DEVICE_ORDER.flatMap((id) => {
          const previous = previousById.get(id);
          const next = nextById.get(id);
          return previous &&
            previous.active &&
            (next?.lifecycle === "finished" || next?.lifecycle === "inactive")
            ? [{ id, label: next.name, occurredAtMs: receivedAtMs } satisfies CompletionAlert]
            : [];
        })
      : [];

    this.#fluxHausInitialized = true;
    this.#fluxHausSourceAtMs = sourceAtMs;
    this.#fluxHausSourceSignature = sourceSignature;
    const nextState = {
      ...this.#state,
      fluxHaus: snapshot,
      fluxHausReceivedAtMs: Math.min(receivedAtMs, Date.now()),
    };
    const frames = availableFrontFrames(nextState, this.#config, Date.now());
    if (frames[this.#frontFrameIndex] !== nextState.frontFrame) {
      const matchingIndex = frames.indexOf(nextState.frontFrame);
      this.#frontFrameIndex = matchingIndex >= 0 ? matchingIndex : 0;
      nextState.frontFrame = frames[this.#frontFrameIndex] ?? DEFAULT_FRONT_FRAME;
    }
    this.#state = nextState;
    for (const alert of completed) {
      this.#completionQueue.push(alert);
    }
    this.#showNextCompletion();
    this.#scheduleRender();
  }

  #showNextCompletion(): void {
    if (!this.#started || this.#stopped || this.#state.completionAlert || this.#completionTimer) {
      return;
    }
    const now = Date.now();
    while (
      this.#completionQueue[0] &&
      now - this.#completionQueue[0].occurredAtMs > COMPLETION_EXPIRY_MS
    ) {
      this.#completionQueue.shift();
    }
    const completionAlert = this.#completionQueue[0];
    if (!completionAlert) return;
    if (!renderMonitor({ ...this.#state, completionAlert }, this.#config, now).renderedCompletionAlert) {
      return;
    }
    this.#completionQueue.shift();
    this.#state = { ...this.#state, completionAlert };
    this.#scheduleRender();
  }

  #confirmCompletionDisplayed(completionAlert: CompletionAlert | null): void {
    this.#discardExpiredUndisplayedCompletion(Date.now());
    if (
      this.#stopped ||
      !completionAlert ||
      this.#state.completionAlert !== completionAlert ||
      this.#completionTimer
    ) {
      return;
    }
    void this.#playCompletionAlertSound(completionAlert);
    this.#completionTimer = setTimeout(() => {
      this.#completionTimer = null;
      if (this.#stopped) return;
      this.#state = { ...this.#state, completionAlert: null };
      this.#scheduleRender();
      this.#showNextCompletion();
    }, COMPLETION_ALERT_MS);
    this.#completionTimer.unref();
  }

  #discardExpiredUndisplayedCompletion(now: number): void {
    const completionAlert = this.#state.completionAlert;
    if (
      !completionAlert ||
      this.#completionTimer ||
      now - completionAlert.occurredAtMs <= COMPLETION_EXPIRY_MS
    ) {
      return;
    }
    this.#state = { ...this.#state, completionAlert: null };
    this.#showNextCompletion();
  }

  async #playCompletionAlertSound(alert: CompletionAlert): Promise<void> {
    if (!this.#config.audioEnabled || !this.#config.alertSound) return;
    try {
      await this.#client.playStockSound(this.#config.applicationName, this.#config.alertSound);
    } catch (error) {
      log.warn({ err: error, device: alert.id }, "BUSY Bar completion alert audio failed");
    }
  }

  #scheduleBrightness(): void {
    if (!this.#started || this.#stopped) return;
    if (this.#brightnessUpdating) {
      this.#brightnessQueued = true;
      return;
    }
    const desired = desiredDisplayBrightness(
      this.#state.weather,
      this.#config.timeZone,
      this.#config.lateNightBrightness,
    );
    if (desired === this.#brightnessValue) return;
    this.#brightnessUpdating = true;
    void this.#client
      .setBrightness(desired)
      .then(() => {
        this.#brightnessValue = desired;
      })
      .catch((error: unknown) => {
        log.warn({ err: error, desired }, "BUSY Bar brightness update failed");
      })
      .finally(() => {
        this.#brightnessUpdating = false;
        if (!this.#brightnessQueued) return;
        this.#brightnessQueued = false;
        this.#scheduleBrightness();
      });
  }

  #refreshSmartHomeStatus(): void {
    const sceneId = this.#config.startSceneId;
    const lightEntityIds = this.#config.startToggleLightIds;
    if (
      !this.#started ||
      this.#stopped ||
      !this.#homeAssistant ||
      !sceneId ||
      lightEntityIds.length === 0
    ) {
      return;
    }
    if (this.#smartHomeActionPending || this.#smartHomeRefreshing) {
      this.#smartHomeRefreshQueued = true;
      return;
    }
    this.#smartHomeRefreshing = true;
    void this.#homeAssistant
      .getSceneLightStatus(sceneId, lightEntityIds)
      .then((status) => {
        if (this.#stopped) return;
        if (this.#smartHomeActionPending) {
          this.#smartHomeRefreshQueued = true;
          return;
        }
        this.#state = {
          ...this.#state,
          smartHomeStatus: status,
        };
        this.#scheduleRender();
      })
      .catch((error: unknown) => {
        log.warn({ err: error, sceneId }, "BUSY Bar smart-home status refresh failed");
      })
      .finally(() => {
        this.#smartHomeRefreshing = false;
        if (!this.#smartHomeRefreshQueued || this.#smartHomeActionPending) return;
        this.#smartHomeRefreshQueued = false;
        this.#refreshSmartHomeStatus();
      });
  }

  #showSmartHomeBackPage(): void {
    if (this.#state.backPage !== 3 && this.#backPageBeforeSmartHome === null) {
      this.#backPageBeforeSmartHome = this.#state.backPage;
    }
    if (this.#backPageRestoreTimer) clearTimeout(this.#backPageRestoreTimer);
    this.#backPageRestoreTimer = null;
    this.#state = { ...this.#state, backPage: 3 };
    this.#scheduleRender();
  }

  #scheduleBackPageRestore(): void {
    if (this.#backPageBeforeSmartHome === null) return;
    if (this.#backPageRestoreTimer) clearTimeout(this.#backPageRestoreTimer);
    this.#backPageRestoreTimer = setTimeout(() => {
      const backPage = this.#backPageBeforeSmartHome;
      this.#backPageRestoreTimer = null;
      this.#backPageBeforeSmartHome = null;
      if (backPage === null || this.#stopped) return;
      this.#state = { ...this.#state, backPage };
      this.#scheduleRender();
    }, SMART_HOME_BACK_DISPLAY_MS);
    this.#backPageRestoreTimer.unref();
  }

  #cancelBackPageRestore(): void {
    if (this.#backPageRestoreTimer) clearTimeout(this.#backPageRestoreTimer);
    this.#backPageRestoreTimer = null;
    this.#backPageBeforeSmartHome = null;
  }

  #handleInput(event: BusyBarInputEvent): void {
    if (event.kind === "switch") return;
    if (event.kind === "button") {
      if (event.action !== "PRESS") return;
      const sceneAction = sceneActionForButton(this.#config, event.button);
      if (sceneAction && this.#homeAssistant) {
        if (this.#smartHomeActionPending) {
          log.debug({ button: event.button }, "BUSY Bar smart-home action already in progress");
          return;
        }
        this.#smartHomeActionPending = true;
        this.#state = {
          ...this.#state,
          smartHomeAction: {
            sceneId: sceneAction.sceneId,
            result: "checking",
          },
        };
        this.#showSmartHomeBackPage();
        const action =
          sceneAction.turnOffLightIds.length > 0
            ? this.#homeAssistant.activateSceneOrTurnOffLights(
                sceneAction.sceneId,
                sceneAction.turnOffLightIds,
              )
            : this.#homeAssistant.activateScene(sceneAction.sceneId).then(() => ({
                result: "activated" as const,
                status: null,
              }));
        void action
          .then(({ result, status }) => {
            if (this.#stopped) return;
            this.#state = {
              ...this.#state,
              ...(status
                ? {
                    smartHomeStatus: status,
                  }
                : {}),
              smartHomeAction: {
                sceneId: sceneAction.sceneId,
                result,
              },
            };
            log.info(
              { button: event.button, sceneId: sceneAction.sceneId, result },
              "BUSY Bar smart-home scene action completed",
            );
            this.#showSceneAnnouncement(
              result === "lightsOff"
                ? "LIGHTS OFF"
                : sceneAnnouncementLabel(sceneAction.sceneId),
            );
            if (status) this.#smartHomeRefreshQueued = true;
            this.#scheduleBackPageRestore();
            this.#scheduleRender();
          })
          .catch((error: unknown) => {
            if (this.#stopped) return;
            this.#state = {
              ...this.#state,
              smartHomeAction: {
                sceneId: sceneAction.sceneId,
                result: "failed",
              },
            };
            log.warn(
              { err: error, button: event.button, sceneId: sceneAction.sceneId },
              "BUSY Bar smart-home scene action failed",
            );
            this.#scheduleBackPageRestore();
            this.#scheduleRender();
          })
          .finally(() => {
            this.#smartHomeActionPending = false;
            if (!this.#smartHomeRefreshQueued) return;
            this.#smartHomeRefreshQueued = false;
            this.#refreshSmartHomeStatus();
          });
        return;
      }
      this.#cancelBackPageRestore();
      this.#state = {
        ...this.#state,
        backPage:
          event.button === "BACK"
            ? nextBackPage(this.#state.backPage, -1)
            : nextBackPage(this.#state.backPage, 1),
      };
    } else {
      const idleMode = nextIdleMode(this.#state.idleMode, event.delta);
      const state = { ...this.#state, idleMode };
      const frames = availableFrontFrames(state, this.#config, Date.now());
      this.#frontFrameIndex = 0;
      this.#state = {
        ...state,
        frontFrame: frames[0] ?? DEFAULT_FRONT_FRAME,
        idleModeAnnouncement: idleMode,
      };
      if (this.#idleModeAnnouncementTimer) clearTimeout(this.#idleModeAnnouncementTimer);
      this.#idleModeAnnouncementTimer = setTimeout(() => {
        this.#idleModeAnnouncementTimer = null;
        this.#state = { ...this.#state, idleModeAnnouncement: null };
        this.#scheduleRender();
      }, 1_500);
      this.#idleModeAnnouncementTimer.unref();
      log.info({ idleMode }, "BUSY Bar idle mode changed");
    }
    this.#scheduleRender();
  }

  #showSceneAnnouncement(label: string): void {
    if (this.#sceneAnnouncementTimer) clearTimeout(this.#sceneAnnouncementTimer);
    const showPhase = (phase: SceneAnnouncement["phase"]): void => {
      this.#state = {
        ...this.#state,
        sceneAnnouncement: { label, phase },
      };
      this.#scheduleRender();
    };
    const finish = (): void => {
      this.#sceneAnnouncementTimer = null;
      this.#state = { ...this.#state, sceneAnnouncement: null };
      this.#scheduleRender();
    };
    const advanceToDone = (): void => {
      showPhase(2);
      this.#sceneAnnouncementTimer = setTimeout(finish, 900);
      this.#sceneAnnouncementTimer.unref();
    };
    const advanceToMiddle = (): void => {
      showPhase(1);
      this.#sceneAnnouncementTimer = setTimeout(advanceToDone, 320);
      this.#sceneAnnouncementTimer.unref();
    };
    showPhase(0);
    this.#sceneAnnouncementTimer = setTimeout(advanceToMiddle, 320);
    this.#sceneAnnouncementTimer.unref();
  }

  #scheduleRender(): void {
    if (!this.#started || this.#stopped || this.#renderTimer || this.#retryTimer) return;
    if (this.#rendering) {
      this.#renderQueued = true;
      return;
    }
    this.#renderTimer = setTimeout(() => {
      this.#renderTimer = null;
      const render = this.#render();
      this.#activeRender = render;
      void render.finally(() => {
        if (this.#activeRender === render) this.#activeRender = null;
      });
    }, this.#config.renderDebounceMs);
    this.#renderTimer.unref();
  }

  async #render(): Promise<void> {
    this.#rendering = true;
    try {
      const now = Date.now();
      this.#discardExpiredUndisplayedCompletion(now);
      const wasDisconnected = !this.#state.cloudConnected;
      const rendered = renderMonitor(
        wasDisconnected ? { ...this.#state, cloudConnected: true } : this.#state,
        this.#config,
        now,
      );
      if (wasDisconnected || rendered.signature !== this.#renderSignature) {
        await this.#client.draw(rendered.payload);
        this.#renderSignature = rendered.signature;
      }
      this.#state = { ...this.#state, cloudConnected: true };
      this.#retryAttempt = 0;
      if (this.#retryTimer) clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
      this.#confirmCompletionDisplayed(rendered.renderedCompletionAlert);
      await this.#maybeAlert(rendered.alertKind);
      if (wasDisconnected) {
        this.#state = { ...this.#state, frontFrame: DEFAULT_FRONT_FRAME };
        this.#frontFrameIndex = 0;
        this.#scheduleRender();
      }
    } catch (error) {
      this.#state = { ...this.#state, cloudConnected: false };
      log.warn({ err: error }, "BUSY Bar render failed");
      this.#scheduleRetry();
    } finally {
      this.#rendering = false;
      if (this.#renderQueued) {
        this.#renderQueued = false;
        this.#scheduleRender();
      }
    }
  }

  async #maybeAlert(kind: "error" | "offline" | "critical" | null): Promise<void> {
    const previousKind = this.#currentAlertKind;
    this.#currentAlertKind = kind;
    if (!kind || kind === previousKind || !this.#config.audioEnabled || !this.#config.alertSound) {
      return;
    }
    const now = Date.now();
    if (now - this.#lastAlertAt[kind] < this.#config.alertCooldownMs) return;
    this.#lastAlertAt[kind] = now;
    try {
      await this.#client.playStockSound(this.#config.applicationName, this.#config.alertSound);
    } catch (error) {
      log.warn({ err: error, kind }, "BUSY Bar alert audio failed");
    }
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.#retryAttempt);
    this.#retryAttempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#scheduleRender();
    }, delay);
    this.#retryTimer.unref();
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopped = true;
    if (this.#renderTimer) clearTimeout(this.#renderTimer);
    if (this.#freshnessTimer) clearInterval(this.#freshnessTimer);
    if (this.#rotationTimer) clearInterval(this.#rotationTimer);
    if (this.#smartHomePollTimer) clearInterval(this.#smartHomePollTimer);
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    if (this.#idleModeAnnouncementTimer) clearTimeout(this.#idleModeAnnouncementTimer);
    if (this.#sceneAnnouncementTimer) clearTimeout(this.#sceneAnnouncementTimer);
    if (this.#backPageRestoreTimer) clearTimeout(this.#backPageRestoreTimer);
    if (this.#completionTimer) clearTimeout(this.#completionTimer);
    this.#inputStream?.stop();
    this.#stopPromise = (async () => {
      if (this.#activeRender) {
        try {
          await this.#activeRender;
        } catch (error) {
          log.warn({ err: error }, "BUSY Bar active render did not finish cleanly");
        }
      }
      try {
        await this.#client.clear(this.#config.applicationName);
      } catch (error) {
        log.warn({ err: error }, "BUSY Bar monitor display cleanup failed");
      }
    })();
    return this.#stopPromise;
  }
}
