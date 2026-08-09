import { isValidTimeZone } from "./time-zone.js";

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export interface WeatherConfig {
  url: string;
  token: string;
  entityId: string;
  sunEntityId: string;
  humidexEntityId: string | null;
  windChillEntityId: string | null;
  precipitationEntityId: string | null;
  pollIntervalMs: number;
  staleAfterMs: number;
  timeZone: string;
}

export type MonitorConfig =
  | { enabled: false }
  | {
      enabled: true;
      token: string;
      apiUrl: string;
      boothId: string;
      localUrl: string | null;
      localAccessKey: string | null;
      applicationName: string;
      displayPriority: number;
      statusStaleAfterMs: number;
      systemStaleAfterMs: number;
      renderDebounceMs: number;
      frontRotationMs: number;
      summaryPollIntervalMs: number;
      timeZone: string;
      clockEnabled: boolean;
      lateNightBrightness: number;
      weather: WeatherConfig | null;
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

function entityId(
  input: string | undefined,
  name: string,
  domain: string,
  required: true,
): string;
function entityId(
  input: string | undefined,
  name: string,
  domain: string,
  required: false,
): string | null;
function entityId(
  input: string | undefined,
  name: string,
  domain: string,
  required: boolean,
): string | null {
  const parsed = value(input);
  if (!parsed) {
    if (required) throw new ConfigurationError(`${name} is required.`);
    return null;
  }
  if (!new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(parsed)) {
    throw new ConfigurationError(`${name} must be a ${domain} entity id.`);
  }
  return parsed;
}

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
  const localUrlValue = value(env.BUSY_BAR_LOCAL_URL);
  const localAccessKey = value(env.BUSY_BAR_LOCAL_ACCESS_KEY);
  if ((localUrlValue === undefined) !== (localAccessKey === undefined)) {
    throw new ConfigurationError(
      "BUSY_BAR_LOCAL_URL and BUSY_BAR_LOCAL_ACCESS_KEY must be configured together.",
    );
  }
  if (localAccessKey && !/^\d{4,10}$/.test(localAccessKey)) {
    throw new ConfigurationError("BUSY_BAR_LOCAL_ACCESS_KEY must contain 4 to 10 digits.");
  }

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
  const weatherEnabled = boolean(env, "BUSY_BAR_WEATHER_ENABLED", false);
  let weather: WeatherConfig | null = null;
  if (weatherEnabled) {
    const homeAssistantUrl = value(env.BUSY_BAR_HOME_ASSISTANT_URL);
    if (!homeAssistantUrl) {
      throw new ConfigurationError(
        "BUSY_BAR_HOME_ASSISTANT_URL is required when weather is enabled.",
      );
    }
    const homeAssistantToken = value(env.BUSY_BAR_HOME_ASSISTANT_TOKEN);
    if (!homeAssistantToken) {
      throw new ConfigurationError(
        "BUSY_BAR_HOME_ASSISTANT_TOKEN is required when weather is enabled.",
      );
    }
    weather = {
      url: url(homeAssistantUrl, "BUSY_BAR_HOME_ASSISTANT_URL", ["http:", "https:"]),
      token: homeAssistantToken,
      entityId: entityId(
        env.BUSY_BAR_WEATHER_ENTITY_ID,
        "BUSY_BAR_WEATHER_ENTITY_ID",
        "weather",
        true,
      ),
      sunEntityId: entityId(
        value(env.BUSY_BAR_SUN_ENTITY_ID) ?? "sun.sun",
        "BUSY_BAR_SUN_ENTITY_ID",
        "sun",
        true,
      ),
      humidexEntityId: entityId(
        env.BUSY_BAR_WEATHER_HUMIDEX_ENTITY_ID,
        "BUSY_BAR_WEATHER_HUMIDEX_ENTITY_ID",
        "sensor",
        false,
      ),
      windChillEntityId: entityId(
        env.BUSY_BAR_WEATHER_WIND_CHILL_ENTITY_ID,
        "BUSY_BAR_WEATHER_WIND_CHILL_ENTITY_ID",
        "sensor",
        false,
      ),
      precipitationEntityId: entityId(
        env.BUSY_BAR_WEATHER_PRECIPITATION_ENTITY_ID,
        "BUSY_BAR_WEATHER_PRECIPITATION_ENTITY_ID",
        "sensor",
        false,
      ),
      pollIntervalMs:
        integer(env, "BUSY_BAR_WEATHER_POLL_SECONDS", 600, 60, 3600) * 1000,
      staleAfterMs:
        integer(env, "BUSY_BAR_WEATHER_STALE_AFTER_SECONDS", 3600, 300, 86_400) * 1000,
      timeZone,
    };
  }

  return {
    enabled: true,
    token,
    apiUrl: url(value(env.BUSY_BAR_API_URL) ?? "https://api.busy.app", "BUSY_BAR_API_URL", [
      "https:",
    ]),
    boothId,
    localUrl: localUrlValue
      ? url(localUrlValue, "BUSY_BAR_LOCAL_URL", ["http:", "https:"])
      : null,
    localAccessKey: localAccessKey ?? null,
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
    clockEnabled: boolean(env, "BUSY_BAR_CLOCK_ENABLED", true),
    lateNightBrightness: integer(env, "BUSY_BAR_LATE_NIGHT_BRIGHTNESS", 5, 5, 100),
    weather,
    audioEnabled,
    alertSound,
    alertCooldownMs: integer(env, "BUSY_BAR_ALERT_COOLDOWN_SECONDS", 300, 10, 86_400) * 1000,
    operatorApiUrl: url(operatorApiUrl, "BUSY_BAR_OPERATOR_API_URL", ["https:"]),
    operatorToken,
  };
};
