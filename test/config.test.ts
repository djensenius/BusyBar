import { describe, expect, it } from "vite-plus/test";
import { ConfigurationError, resolveConfig } from "../src/config.js";

const base = {
  BUSY_BAR_CLOUD_TOKEN: "cloud-token",
  BUSY_BAR_OPERATOR_API_URL: "https://operator.example.com",
  BUSY_BAR_OPERATOR_TOKEN: "operator-token",
  BUSY_BAR_BOOTH_ID: "booth-01",
};

describe("monitor configuration", () => {
  it("can be disabled explicitly", () => {
    expect(resolveConfig({ BUSY_BAR_MONITOR_ENABLED: "false" })).toEqual({ enabled: false });
  });

  it("requires cloud and Operator credentials", () => {
    expect(() => resolveConfig({})).toThrow(ConfigurationError);
    expect(() =>
      resolveConfig({
        BUSY_BAR_CLOUD_TOKEN: "cloud-token",
        BUSY_BAR_OPERATOR_TOKEN: "operator-token",
        BUSY_BAR_BOOTH_ID: "booth-01",
      }),
    ).toThrow("BUSY_BAR_OPERATOR_API_URL");
  });

  it("resolves production-safe defaults", () => {
    expect(resolveConfig(base)).toMatchObject({
      enabled: true,
      apiUrl: "https://api.busy.app",
      cloudWebSocketUrl: "wss://api.busy.app/api/v1/bars/ws",
      statusStaleAfterMs: 75_000,
      systemStaleAfterMs: 20_000,
      summaryPollIntervalMs: 30_000,
      timeZone: "America/Toronto",
      audioEnabled: false,
    });
  });

  it("keeps the legacy shared timeout as a fallback", () => {
    expect(
      resolveConfig({
        ...base,
        BUSY_BAR_STALE_AFTER_SECONDS: "45",
        BUSY_BAR_SYSTEM_STALE_AFTER_SECONDS: "15",
      }),
    ).toMatchObject({
      statusStaleAfterMs: 45_000,
      systemStaleAfterMs: 15_000,
    });
  });

  it("validates URLs, bounds, booleans, time zones, and audio", () => {
    expect(() => resolveConfig({ ...base, BUSY_BAR_API_URL: "http://api.busy.app" })).toThrow(
      "BUSY_BAR_API_URL",
    );
    expect(() => resolveConfig({ ...base, BUSY_BAR_STATUS_STALE_AFTER_SECONDS: "4" })).toThrow(
      "BUSY_BAR_STATUS_STALE_AFTER_SECONDS",
    );
    expect(() => resolveConfig({ ...base, BUSY_BAR_AUDIO_ENABLED: "TRUE" })).toThrow(
      "BUSY_BAR_AUDIO_ENABLED",
    );
    expect(() => resolveConfig({ ...base, BUSY_BAR_TIME_ZONE: "Telephone/Booth" })).toThrow(
      "BUSY_BAR_TIME_ZONE",
    );
    expect(() => resolveConfig({ ...base, BUSY_BAR_AUDIO_ENABLED: "true" })).toThrow(
      "BUSY_BAR_ALERT_SOUND",
    );
  });
});
