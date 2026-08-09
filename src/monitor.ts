import { aggregateSystemHealthSeverity } from "./health.js";
import { log } from "./logger.js";
import type { BusyBarDeviceClient } from "./busy-client.js";
import type { MonitorConfig } from "./config.js";
import type { BusyBarInputEvent, BusyBarInputStreamHandle } from "./input-stream.js";
import { startBusyBarInputStream } from "./input-stream.js";
import type { BackPage, IdleMode, MonitorState } from "./renderer.js";
import { availableFrontFrames, renderMonitor } from "./renderer.js";
import type { BoothStatus, BoothSystemSnapshotEnvelope, MonitorSummary } from "./schemas.js";
import type { WeatherSnapshot } from "./weather-client.js";

const nextPage = (page: BackPage, direction: number): BackPage =>
  ((((page + direction) % 3) + 3) % 3) as BackPage;

const nextFrontFrame = (
  current: MonitorState["frontFrame"],
  frames: readonly MonitorState["frontFrame"][],
): MonitorState["frontFrame"] => {
  const index = frames.indexOf(current);
  return frames[(index + 1) % frames.length] ?? frames[0] ?? "callsToday";
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
  #state: MonitorState = {
    status: null,
    statusReceivedAtMs: null,
    system: null,
    systemReceivedAtMs: null,
    summary: null,
    weather: null,
    weatherReceivedAtMs: null,
    frontFrame: "callsToday",
    idleMode: "all",
    idleModeAnnouncement: null,
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
  #summarySourceAtMs: number | null = null;
  #brightnessValue: number | "auto" | null = null;
  #brightnessUpdating = false;
  #brightnessQueued = false;
  #idleModeAnnouncementTimer: NodeJS.Timeout | null = null;

  constructor(config: Extract<MonitorConfig, { enabled: true }>, client: BusyBarDeviceClient) {
    this.#config = config;
    this.#client = client;
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
    }, 5_000);
    this.#freshnessTimer.unref();
    this.#rotationTimer = setInterval(() => {
      if (this.#state.status?.state !== "idle") return;
      const frames = availableFrontFrames(this.#state, this.#config, Date.now());
      this.#state = {
        ...this.#state,
        frontFrame: nextFrontFrame(this.#state.frontFrame, frames),
      };
      this.#scheduleRender();
    }, this.#config.frontRotationMs);
    this.#rotationTimer.unref();
    this.#state = { ...this.#state, cloudConnected: true };
    this.#scheduleRender();
    log.info("BUSY Bar monitor started");
  }

  updateStatus(status: BoothStatus, receivedAtMs = Date.now()): void {
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
      frontFrame: status.state === "idle" && wasActive ? "callsToday" : this.#state.frontFrame,
    };
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
      frontFrame: recovered ? "callsToday" : this.#state.frontFrame,
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

  #handleInput(event: BusyBarInputEvent): void {
    if (event.kind === "switch") return;
    if (event.kind === "button") {
      if (event.action !== "PRESS") return;
      this.#state = {
        ...this.#state,
        backPage: event.button === "BACK" ? 0 : nextPage(this.#state.backPage, 1),
      };
    } else {
      const idleMode = nextIdleMode(this.#state.idleMode, event.delta);
      const state = { ...this.#state, idleMode };
      const frames = availableFrontFrames(state, this.#config, Date.now());
      this.#state = {
        ...state,
        frontFrame: frames[0] ?? "callsToday",
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
      const wasDisconnected = !this.#state.cloudConnected;
      const rendered = renderMonitor(
        wasDisconnected ? { ...this.#state, cloudConnected: true } : this.#state,
        this.#config,
        Date.now(),
      );
      if (wasDisconnected || rendered.signature !== this.#renderSignature) {
        await this.#client.draw(rendered.payload);
        this.#renderSignature = rendered.signature;
      }
      this.#state = { ...this.#state, cloudConnected: true };
      this.#retryAttempt = 0;
      if (this.#retryTimer) clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
      await this.#maybeAlert(rendered.alertKind);
      if (wasDisconnected) {
        this.#state = { ...this.#state, frontFrame: "callsToday" };
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
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    if (this.#idleModeAnnouncementTimer) clearTimeout(this.#idleModeAnnouncementTimer);
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
