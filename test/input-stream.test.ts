import { describe, expect, it } from "vite-plus/test";
import {
  busyBarInputWebSocketUrl,
  decodeBusyBarCloudFrame,
  decodeBusyBarInputEvents,
  decodeBusyBarInputFrame,
} from "../src/input-stream.js";

describe("BUSY Bar input protobuf decoder", () => {
  it("decodes button press and release events", () => {
    const bytes = Uint8Array.from([0x12, 0x08, 0x5a, 0x06, 0x0a, 0x04, 0x08, 0x01, 0x10, 0x01]);
    expect(decodeBusyBarInputEvents(bytes)).toEqual([
      { kind: "button", button: "BACK", action: "RELEASE" },
    ]);
  });

  it("materializes default OK press enum values", () => {
    const bytes = Uint8Array.from([0x12, 0x04, 0x5a, 0x02, 0x0a, 0x00]);
    expect(decodeBusyBarInputEvents(bytes)).toEqual([
      { kind: "button", button: "OK", action: "PRESS" },
    ]);
  });

  it("decodes encoder direction", () => {
    const bytes = Uint8Array.from([0x12, 0x06, 0x5a, 0x04, 0x1a, 0x02, 0x08, 0x01]);
    expect(decodeBusyBarInputEvents(bytes)).toEqual([{ kind: "encoder", delta: -1 }]);
  });

  it("ignores unrelated state updates", () => {
    expect(decodeBusyBarInputEvents(Uint8Array.from([0x12, 0x00]))).toEqual([]);
  });

  it("accepts current and legacy cloud protobuf envelopes", () => {
    const encoded = Buffer.from([1, 2, 3]).toString("base64");
    expect(
      decodeBusyBarCloudFrame(Buffer.from(JSON.stringify({ type: "protobuf", state: encoded }))),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(
      decodeBusyBarCloudFrame(Buffer.from(JSON.stringify({ bar_id: "device", state: encoded }))),
    ).toEqual(Buffer.from([1, 2, 3]));
  });

  it("accepts raw local protobuf frames", () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(decodeBusyBarInputFrame(bytes, true)).toEqual(bytes);
  });

  it("builds an authenticated local WebSocket URL", () => {
    expect(busyBarInputWebSocketUrl("http://192.168.1.247", "1234567890")).toBe(
      "ws://192.168.1.247/api/status/ws?x-api-token=1234567890",
    );
  });
});
