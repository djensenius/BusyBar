import { isValidTimeZone } from "./time-zone.js";

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export type MonitorConfig =
  | { enabled: false }
  | {
      enabled: true;
      token: string;
      apiUrl: string;
      cloudWebSocketUrl: string;
      boothId: string;
      deviceId: string | null;
      applicationName: string;
      displayPriority: number;
      statusStaleAfterMs: number;
      systemStaleAfterMs: number;
      renderDebounceMs: number;
      frontRotationMs: number;
      summaryPollIntervalMs: number;
      timeZone: string;
      audioEnabled: boolean;
      alertSound: string | null;
      alertCooldownMs: number;
      operatorApiUrl: string;
      operatorToken: string;
    };

const value = (input: string | undefined): string | undefined => {
  const trimmed = input?.trim();
  return trimmed ? trimmed : undefined;
};

const boolean = (env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean => {
  const raw = value(env[name]);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigurationError(`${name} must be true or false.`);
};

const parseInteger = (raw: string, name: string, minimum: number, maximum: number): number => {
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

const integer = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const raw = value(env[name]);
  return raw === undefined ? fallback : parseInteger(raw, name, minimum, maximum);
};

const optionalInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined => {
  const raw = value(env[name]);
  return raw === undefined ? undefined : parseInteger(raw, name, minimum, maximum);
};

const url = (input: string, name: string, protocols: readonly string[]): string => {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigurationError(`${name} must use ${protocols.join(" or ")}.`);
  }
  return parsed.toString().replace(/\/$/, "");
};

export const resolveConfig = (env: NodeJS.ProcessEnv = process.env): MonitorConfig => {
  if (!boolean(env, "BUSY_BAR_MONITOR_ENABLED", true)) return { enabled: false };
  const token = value(env.BUSY_BAR_CLOUD_TOKEN);
  if (!token) throw new ConfigurationError("BUSY_BAR_CLOUD_TOKEN is required.");
  const operatorToken = value(env.BUSY_BAR_OPERATOR_TOKEN);
  if (!operatorToken) throw new ConfigurationError("BUSY_BAR_OPERATOR_TOKEN is required.");
  const operatorApiUrl = value(env.BUSY_BAR_OPERATOR_API_URL);
  if (!operatorApiUrl) throw new ConfigurationError("BUSY_BAR_OPERATOR_API_URL is required.");
  const boothId = value(env.BUSY_BAR_BOOTH_ID);
  if (!boothId) throw new ConfigurationError("BUSY_BAR_BOOTH_ID is required.");

  const audioEnabled = boolean(env, "BUSY_BAR_AUDIO_ENABLED", false);
  const alertSound = value(env.BUSY_BAR_ALERT_SOUND) ?? null;
  if (audioEnabled && !alertSound) {
    throw new ConfigurationError(
      "BUSY_BAR_ALERT_SOUND is required when BUSY_BAR_AUDIO_ENABLED=true.",
    );
  }
  const timeZone = value(env.BUSY_BAR_TIME_ZONE) ?? "America/Toronto";
  if (!isValidTimeZone(timeZone)) {
    throw new ConfigurationError("BUSY_BAR_TIME_ZONE must be a valid IANA time zone.");
  }
  const sharedStaleAfterSeconds = optionalInteger(env, "BUSY_BAR_STALE_AFTER_SECONDS", 5, 3600);

  return {
    enabled: true,
    token,
    apiUrl: url(value(env.BUSY_BAR_API_URL) ?? "https://api.busy.app", "BUSY_BAR_API_URL", [
      "https:",
    ]),
    cloudWebSocketUrl: url(
      value(env.BUSY_BAR_CLOUD_WS_URL) ?? "wss://api.busy.app/api/v1/bars/ws",
      "BUSY_BAR_CLOUD_WS_URL",
      ["wss:"],
    ),
    boothId,
    deviceId: value(env.BUSY_BAR_DEVICE_ID) ?? null,
    applicationName: value(env.BUSY_BAR_APPLICATION_NAME) ?? "telephone-booth-monitor",
    displayPriority: integer(env, "BUSY_BAR_DISPLAY_PRIORITY", 100, 1, 100),
    statusStaleAfterMs:
      integer(env, "BUSY_BAR_STATUS_STALE_AFTER_SECONDS", sharedStaleAfterSeconds ?? 75, 5, 3600) *
      1000,
    systemStaleAfterMs:
      integer(env, "BUSY_BAR_SYSTEM_STALE_AFTER_SECONDS", sharedStaleAfterSeconds ?? 20, 5, 3600) *
      1000,
    renderDebounceMs: integer(env, "BUSY_BAR_RENDER_DEBOUNCE_MS", 250, 0, 10_000),
    frontRotationMs: integer(env, "BUSY_BAR_FRONT_ROTATION_SECONDS", 8, 3, 60) * 1000,
    summaryPollIntervalMs: integer(env, "BUSY_BAR_SUMMARY_POLL_SECONDS", 30, 10, 3600) * 1000,
    timeZone,
    audioEnabled,
    alertSound,
    alertCooldownMs: integer(env, "BUSY_BAR_ALERT_COOLDOWN_SECONDS", 300, 10, 86_400) * 1000,
    operatorApiUrl: url(operatorApiUrl, "BUSY_BAR_OPERATOR_API_URL", ["https:"]),
    operatorToken,
  };
};
