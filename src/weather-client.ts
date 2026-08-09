import { z } from "zod";
import type { WeatherConfig } from "./config.js";
import { log } from "./logger.js";

export const WeatherConditionSchema = z.enum([
  "clear-night",
  "cloudy",
  "exceptional",
  "fog",
  "hail",
  "lightning",
  "lightning-rainy",
  "partlycloudy",
  "pouring",
  "rainy",
  "snowy",
  "snowy-rainy",
  "sunny",
  "windy",
  "windy-variant",
]);
export type WeatherCondition = z.infer<typeof WeatherConditionSchema>;

export type WeatherPrecipitationKind = "rain" | "snow" | "mix";

export interface WeatherSnapshot {
  condition: WeatherCondition;
  sunState: "above_horizon" | "below_horizon";
  temperatureCelsius: number;
  feelsLikeCelsius: number | null;
  precipitationProbability: number | null;
  precipitationKind: WeatherPrecipitationKind | null;
  highCelsius: number | null;
  lowCelsius: number | null;
  humidityPercent: number | null;
  observedAt: string;
}

const WeatherStateSchema = z.object({
  state: WeatherConditionSchema,
  last_updated: z.string().datetime({ offset: true }),
  attributes: z
    .object({
      temperature: z.number(),
      apparent_temperature: z.number().nullable().optional(),
      temperature_unit: z.string().min(1),
      humidity: z.number().min(0).max(100).nullable().optional(),
    })
    .passthrough(),
});

const SunStateSchema = z.object({
  state: z.enum(["above_horizon", "below_horizon"]),
});

const NumericSensorStateSchema = z.object({
  state: z.string(),
  attributes: z
    .object({
      unit_of_measurement: z.string().nullable().optional(),
    })
    .passthrough(),
});

const ForecastEntrySchema = z
  .object({
    datetime: z.string().datetime({ offset: true }),
    condition: WeatherConditionSchema.nullable().optional(),
    temperature: z.number().nullable().optional(),
    templow: z.number().nullable().optional(),
    apparent_temperature: z.number().nullable().optional(),
    precipitation_probability: z.number().min(0).max(100).nullable().optional(),
  })
  .passthrough();

const ForecastBundleSchema = z.object({
  forecast: z.array(ForecastEntrySchema),
});

type ForecastEntry = z.infer<typeof ForecastEntrySchema>;

const fetchJson = async (
  config: WeatherConfig,
  path: string,
  init: RequestInit = {},
  allowNotFound = false,
): Promise<unknown | null> => {
  const response = await fetch(new URL(path, config.url), {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Home Assistant returned ${response.status} for ${new URL(path, config.url).pathname}`);
  }
  return response.json();
};

const readForecast = async (
  config: WeatherConfig,
  type: "hourly" | "daily",
): Promise<ForecastEntry[]> => {
  const raw = await fetchJson(config, "/api/services/weather/get_forecasts?return_response", {
    method: "POST",
    body: JSON.stringify({
      entity_id: config.entityId,
      type,
    }),
  });
  const response = z.record(z.string(), z.unknown()).parse(raw);
  const serviceResponse =
    "service_response" in response
      ? z.record(z.string(), z.unknown()).parse(response.service_response)
      : response;
  const bundle = ForecastBundleSchema.safeParse(serviceResponse[config.entityId]);
  if (!bundle.success) {
    throw new Error(`Home Assistant did not return a ${type} forecast for ${config.entityId}`);
  }
  return bundle.data.forecast;
};

const normalizeTemperature = (temperature: number, unit: string): number => {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "°c" || normalized === "c" || normalized === "celsius") return temperature;
  if (normalized === "°f" || normalized === "f" || normalized === "fahrenheit") {
    return ((temperature - 32) * 5) / 9;
  }
  throw new Error(`Unsupported Home Assistant temperature unit: ${unit}`);
};

const readNumericSensor = async (
  config: WeatherConfig,
  entityId: string | null,
  fallbackUnit: string,
  temperature: boolean,
): Promise<number | null> => {
  if (!entityId) return null;
  const raw = await fetchJson(config, `/api/states/${encodeURIComponent(entityId)}`, {}, true);
  if (raw === null) return null;
  const state = NumericSensorStateSchema.parse(raw);
  if (state.state === "unknown" || state.state === "unavailable") return null;
  const parsed = Number(state.state);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Home Assistant entity ${entityId} did not contain a numeric state`);
  }
  return temperature
    ? normalizeTemperature(parsed, state.attributes.unit_of_measurement ?? fallbackUnit)
    : parsed;
};

const localDateKey = (timestamp: string | number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));

const precipitationKind = (
  condition: WeatherCondition | null | undefined,
): WeatherPrecipitationKind => {
  if (condition === "snowy") return "snow";
  if (condition === "snowy-rainy" || condition === "hail") return "mix";
  return "rain";
};

export const readHomeAssistantWeather = async (
  config: WeatherConfig,
  nowMs = Date.now(),
): Promise<WeatherSnapshot> => {
  const [currentRaw, sunRaw, humidex, windChill, precipitationSensor] = await Promise.all([
    fetchJson(config, `/api/states/${encodeURIComponent(config.entityId)}`),
    fetchJson(config, `/api/states/${encodeURIComponent(config.sunEntityId)}`),
    readNumericSensor(config, config.humidexEntityId, "°C", true),
    readNumericSensor(config, config.windChillEntityId, "°C", true),
    readNumericSensor(config, config.precipitationEntityId, "%", false),
  ]);
  const hourly = await readForecast(config, "hourly");
  const daily = await readForecast(config, "daily");
  const current = WeatherStateSchema.parse(currentRaw);
  const sun = SunStateSchema.parse(sunRaw);
  const temperatureUnit = current.attributes.temperature_unit;
  const temperatureCelsius = normalizeTemperature(
    current.attributes.temperature,
    temperatureUnit,
  );
  const apparentTemperature =
    current.attributes.apparent_temperature == null
      ? null
      : normalizeTemperature(current.attributes.apparent_temperature, temperatureUnit);
  const feelsLikeCelsius = apparentTemperature ?? windChill ?? humidex;

  const futureHourly = hourly
    .filter((entry) => Date.parse(entry.datetime) >= nowMs - 5 * 60_000)
    .slice(0, 2);
  const precipitationForecast = futureHourly
    .filter(
      (entry): entry is ForecastEntry & { precipitation_probability: number } =>
        typeof entry.precipitation_probability === "number",
    )
    .sort((left, right) => right.precipitation_probability - left.precipitation_probability)[0];
  const precipitationProbability =
    precipitationForecast?.precipitation_probability ?? precipitationSensor;
  if (
    precipitationProbability !== null &&
    (precipitationProbability < 0 || precipitationProbability > 100)
  ) {
    throw new Error("Home Assistant precipitation probability must be between 0 and 100");
  }

  const todayKey = localDateKey(nowMs, config.timeZone);
  const today = daily.find((entry) => localDateKey(entry.datetime, config.timeZone) === todayKey);
  const completeDaily =
    today?.temperature != null && today.templow != null
      ? today
      : daily.find(
          (entry) =>
            localDateKey(entry.datetime, config.timeZone) >= todayKey &&
            entry.temperature != null &&
            entry.templow != null,
        );
  const selectedDaily = completeDaily ?? today ?? daily[0];
  const highCelsius =
    selectedDaily?.temperature == null
      ? null
      : normalizeTemperature(selectedDaily.temperature, temperatureUnit);
  const lowCelsius =
    selectedDaily?.templow == null
      ? null
      : normalizeTemperature(selectedDaily.templow, temperatureUnit);

  return {
    condition: current.state,
    sunState: sun.state,
    temperatureCelsius,
    feelsLikeCelsius,
    precipitationProbability,
    precipitationKind:
      precipitationProbability === null
        ? null
        : precipitationKind(precipitationForecast?.condition ?? current.state),
    highCelsius,
    lowCelsius,
    humidityPercent: current.attributes.humidity ?? null,
    observedAt: current.last_updated,
  };
};

export interface WeatherMonitor {
  updateWeather(weather: WeatherSnapshot, receivedAtMs?: number): void;
}

export interface WeatherFeedHandle {
  stop(): void;
}

export const startHomeAssistantWeatherPolling = (
  config: WeatherConfig,
  monitor: WeatherMonitor,
): WeatherFeedHandle => {
  let stopped = false;
  let polling = false;
  let timer: NodeJS.Timeout | null = null;

  const poll = async (): Promise<void> => {
    if (stopped || polling) return;
    polling = true;
    try {
      const weather = await readHomeAssistantWeather(config);
      if (!stopped) monitor.updateWeather(weather);
    } catch (error) {
      log.warn({ err: error }, "Home Assistant weather poll failed");
    } finally {
      polling = false;
    }
  };

  void poll();
  timer = setInterval(() => {
    void poll();
  }, config.pollIntervalMs);
  timer.unref();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
};
