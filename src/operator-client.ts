import { WebSocket } from "ws";
import { log } from "./logger.js";
import {
  BoothStatusSchema,
  BoothSystemSnapshotEnvelopeSchema,
  MonitorSummarySchema,
  RouterTelemetryListSchema,
  WsEnvelopeSchema,
} from "./schemas.js";
import type {
  BoothStatus,
  BoothSystemSnapshotEnvelope,
  MonitorSummary,
  RouterTelemetryEnvelope,
} from "./schemas.js";

const websocketUrl = (apiUrl: string): string => {
  const url = new URL("/v1/ws/status", apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const fetchJson = async (url: URL, token: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Operator API returned ${response.status} for ${url.pathname}`);
  }
  return response.json();
};

export const readStatus = async (apiUrl: string, token: string): Promise<BoothStatus | null> => {
  const status = BoothStatusSchema.parse(await fetchJson(new URL("/v1/status", apiUrl), token));
  return status.id === undefined ? null : status;
};

export const readSystem = async (
  apiUrl: string,
  token: string,
  boothId: string,
): Promise<BoothSystemSnapshotEnvelope | null> => {
  const url = new URL("/v1/system/current", apiUrl);
  url.searchParams.set("boothId", boothId);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Operator API returned ${response.status} for ${url.pathname}`);
  }
  return BoothSystemSnapshotEnvelopeSchema.parse(await response.json());
};

export const readSummary = async (
  apiUrl: string,
  token: string,
  timeZone: string,
): Promise<MonitorSummary> => {
  const url = new URL("/v1/monitor/summary", apiUrl);
  url.searchParams.set("timeZone", timeZone);
  return MonitorSummarySchema.parse(await fetchJson(url, token));
};

export const readRouterTelemetry = async (
  apiUrl: string,
  token: string,
  boothId: string,
): Promise<RouterTelemetryEnvelope | null> => {
  const url = new URL("/v1/system/components/current", apiUrl);
  url.searchParams.set("boothId", boothId);
  url.searchParams.set("componentId", "router");
  const sources = RouterTelemetryListSchema.parse(await fetchJson(url, token));
  return sources.find((source) => source.componentId === "router") ?? null;
};

export interface OperatorFeedHandle {
  stop(): void;
}

export interface OperatorMonitor {
  updateStatus(status: BoothStatus, receivedAtMs?: number): void;
  updateSystem(system: BoothSystemSnapshotEnvelope, receivedAtMs?: number): void;
  updateRouterTelemetry(router: RouterTelemetryEnvelope, receivedAtMs?: number): void;
  updateSummary(summary: MonitorSummary): void;
}

export const startOperatorStream = (
  apiUrl: string,
  token: string,
  boothId: string,
  monitor: OperatorMonitor,
): OperatorFeedHandle => {
  let socket: WebSocket | null = null;
  let retry: NodeJS.Timeout | null = null;
  let stopped = false;
  let attempt = 0;

  const connect = (): void => {
    if (stopped) return;
    const current = new WebSocket(websocketUrl(apiUrl), {
      headers: { authorization: `Bearer ${token}` },
    });
    socket = current;
    current.on("open", () => {
      attempt = 0;
      log.info("connected to Operator status stream");
    });
    current.on("message", (data) => {
      let raw: unknown;
      try {
        const text =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : data instanceof ArrayBuffer
                ? Buffer.from(data).toString("utf8")
                : Buffer.concat(data).toString("utf8");
        raw = JSON.parse(text);
      } catch {
        return;
      }
      const parsed = WsEnvelopeSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.kind === "status") {
        monitor.updateStatus(parsed.data.status);
      } else if (parsed.data.boothId === boothId) {
        monitor.updateSystem({
          boothId: parsed.data.boothId,
          snapshot: parsed.data.snapshot,
          receivedAt: parsed.data.receivedAt,
          version: parsed.data.version ?? null,
        });
      }
    });
    current.on("error", (error) => {
      log.warn({ err: error }, "Operator status stream failed");
    });
    current.on("close", (code) => {
      if (socket !== current) return;
      socket = null;
      if (stopped || code === 1008) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt += 1;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, delay);
      retry.unref();
    });
  };

  connect();
  return {
    stop(): void {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close(1000, "monitor stopped");
    },
  };
};

export const startOperatorPolling = (
  apiUrl: string,
  token: string,
  boothId: string,
  monitor: OperatorMonitor,
): OperatorFeedHandle => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let polling = false;

  const poll = async (): Promise<void> => {
    if (stopped || polling) return;
    polling = true;
    await Promise.all([
      readStatus(apiUrl, token)
        .then((status) => {
          if (status && !stopped) monitor.updateStatus(status);
        })
        .catch((error: unknown) => {
          log.warn({ err: error }, "Operator status poll failed");
        }),
      readSystem(apiUrl, token, boothId)
        .then((system) => {
          if (system && !stopped) monitor.updateSystem(system);
        })
        .catch((error: unknown) => {
          log.warn({ err: error }, "Operator system poll failed");
        }),
      readRouterTelemetry(apiUrl, token, boothId)
        .then((router) => {
          if (router && !stopped) monitor.updateRouterTelemetry(router);
        })
        .catch((error: unknown) => {
          log.warn({ err: error }, "Operator router telemetry poll failed");
        }),
    ]);
    polling = false;
  };

  timer = setInterval(() => {
    void poll();
  }, 5_000);
  void poll();
  return {
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
};

export const startSummaryPolling = (
  apiUrl: string,
  token: string,
  timeZone: string,
  intervalMs: number,
  monitor: OperatorMonitor,
): OperatorFeedHandle => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let polling = false;

  const poll = async (): Promise<void> => {
    if (stopped || polling) return;
    polling = true;
    try {
      const summary = await readSummary(apiUrl, token, timeZone);
      if (!stopped) monitor.updateSummary(summary);
    } catch (error) {
      log.warn({ err: error }, "Operator summary poll failed");
    } finally {
      polling = false;
    }
  };

  void poll();
  timer = setInterval(() => {
    void poll();
  }, intervalMs);
  timer.unref();
  return {
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
};
