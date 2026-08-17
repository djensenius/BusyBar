import protobuf from "protobufjs";
import { WebSocket } from "ws";

export type BusyBarInputEvent =
  | { kind: "button"; button: "OK" | "BACK" | "START"; action: "PRESS" | "RELEASE" }
  | { kind: "encoder"; delta: number }
  | { kind: "switch" };

interface BusyBarInputStreamOptions {
  url: string;
  accessKey: string;
  onInput(event: BusyBarInputEvent): void;
  onFrame?(byteLength: number, eventCount: number): void;
  onStatus(connected: boolean): void;
  onError(error: Error): void;
  heartbeatIntervalMs?: number;
}

const INPUT_HEARTBEAT_INTERVAL_MS = 15_000;

const root = protobuf.Root.fromJSON({
  nested: {
    BSB_State: {
      nested: {
        State: {
          fields: {
            timestamp: { type: "fixed64", id: 1 },
            updates: { rule: "repeated", type: "StateUpdate", id: 2 },
          },
        },
        StateUpdate: {
          fields: {
            input: { type: "BSB_Input.InputEvent", id: 11 },
          },
        },
      },
    },
    BSB_Input: {
      nested: {
        Button: { values: { OK: 0, BACK: 1, START: 2 } },
        ButtonAction: { values: { PRESS: 0, RELEASE: 1 } },
        SwitchPosition: {
          values: { BUSY: 0, CUSTOM: 1, OFF: 2, APPS: 3, SETTINGS: 4 },
        },
        ButtonEvent: {
          fields: {
            button: { type: "Button", id: 1 },
            action: { type: "ButtonAction", id: 2 },
          },
        },
        SwitchEvent: {
          fields: {
            position: { type: "SwitchPosition", id: 1 },
          },
        },
        EncoderEvent: {
          fields: {
            delta: { type: "sint32", id: 1 },
          },
        },
        InputEvent: {
          oneofs: {
            event: { oneof: ["buttonEvent", "switchEvent", "encoderEvent"] },
          },
          fields: {
            buttonEvent: { type: "ButtonEvent", id: 1 },
            switchEvent: { type: "SwitchEvent", id: 2 },
            encoderEvent: { type: "EncoderEvent", id: 3 },
          },
        },
      },
    },
  },
});

const StateType = root.lookupType("BSB_State.State");

type DecodedState = {
  updates?: Array<{
    input?: {
      buttonEvent?: { button?: string; action?: string };
      encoderEvent?: { delta?: number };
      switchEvent?: object;
    };
  }>;
};

export const decodeBusyBarCloudFrame = (data: WebSocket.RawData): Uint8Array | null => {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) return null;
  const text = typeof data === "string" ? data : data.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.state !== "string" || (frame.type !== undefined && frame.type !== "protobuf")) {
    return null;
  }
  return Buffer.from(frame.state, "base64");
};

export const decodeBusyBarInputFrame = (
  data: WebSocket.RawData,
  isBinary: boolean,
): Uint8Array | null => {
  if (!isBinary) return decodeBusyBarCloudFrame(data);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return null;
};

export const busyBarInputWebSocketUrl = (url: string, accessKey: string): string => {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/api/status/ws";
  parsed.search = "";
  parsed.searchParams.set("x-api-token", accessKey);
  return parsed.toString();
};

export const decodeBusyBarInputEvents = (bytes: Uint8Array): BusyBarInputEvent[] => {
  const message = StateType.decode(bytes);
  const decoded = StateType.toObject(message, {
    longs: Number,
    bytes: Uint8Array,
    enums: String,
    defaults: true,
  }) as DecodedState;
  const events: BusyBarInputEvent[] = [];
  for (const update of decoded.updates ?? []) {
    const input = update.input;
    const button = input?.buttonEvent;
    if (
      button?.button &&
      (button.button === "OK" || button.button === "BACK" || button.button === "START") &&
      (button.action === "PRESS" || button.action === "RELEASE")
    ) {
      events.push({ kind: "button", button: button.button, action: button.action });
      continue;
    }
    const delta = input?.encoderEvent?.delta;
    if (typeof delta === "number" && delta !== 0) {
      events.push({ kind: "encoder", delta });
      continue;
    }
    if (input?.switchEvent) events.push({ kind: "switch" });
  }
  return events;
};

export interface BusyBarInputStreamHandle {
  stop(): void;
}

export const startBusyBarInputStream = (
  options: BusyBarInputStreamOptions,
): BusyBarInputStreamHandle => {
  let socket: WebSocket | null = null;
  let retry: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let stopped = false;
  let attempt = 0;

  const clearHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const reconnect = (): void => {
    if (stopped || retry) return;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 250);
    attempt += 1;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
    retry.unref();
  };

  const connect = (): void => {
    if (stopped) return;
    const current = new WebSocket(
      busyBarInputWebSocketUrl(options.url, options.accessKey),
    );
    let awaitingPong = false;
    socket = current;
    current.on("open", () => {
      attempt = 0;
      options.onStatus(true);
      current.send(JSON.stringify({ enable: true }));
      clearHeartbeat();
      heartbeat = setInterval(() => {
        if (socket !== current || current.readyState !== WebSocket.OPEN) return;
        if (awaitingPong) {
          options.onError(new Error("BUSY Bar input stream heartbeat timed out"));
          current.terminate();
          return;
        }
        awaitingPong = true;
        try {
          current.ping();
        } catch (error) {
          options.onError(
            error instanceof Error ? error : new Error("BUSY Bar input heartbeat failed"),
          );
          current.terminate();
        }
      }, options.heartbeatIntervalMs ?? INPUT_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
    });
    current.on("pong", () => {
      awaitingPong = false;
    });
    current.on("message", (data, isBinary) => {
      awaitingPong = false;
      const bytes = decodeBusyBarInputFrame(data, isBinary);
      if (!bytes) return;
      try {
        const events = decodeBusyBarInputEvents(bytes);
        options.onFrame?.(bytes.byteLength, events.length);
        for (const event of events) options.onInput(event);
      } catch (error) {
        options.onError(
          error instanceof Error ? error : new Error("BUSY Bar input protobuf decode failed"),
        );
      }
    });
    current.on("error", (error) => {
      options.onError(error);
    });
    current.on("close", (code) => {
      if (socket !== current) return;
      clearHeartbeat();
      socket = null;
      options.onStatus(false);
      if (!stopped) {
        if (code === 3000 || code === 1008) {
          options.onError(new Error("BUSY Bar local input authentication failed"));
          return;
        }
        reconnect();
      }
    });
  };

  connect();
  return {
    stop(): void {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      clearHeartbeat();
      socket?.close(1000, "monitor stopped");
      socket = null;
    },
  };
};
