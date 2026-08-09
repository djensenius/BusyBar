import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { WeatherConfig } from "../src/config.js";
import { readHomeAssistantWeather } from "../src/weather-client.js";

const config: WeatherConfig = {
  url: "https://homeassistant.example.com",
  token: "ha-token",
  entityId: "weather.patio",
  sunEntityId: "sun.sun",
  humidexEntityId: "sensor.patio_humidex",
  windChillEntityId: "sensor.patio_wind_chill",
  precipitationEntityId: "sensor.patio_precipitation",
  pollIntervalMs: 600_000,
  staleAfterMs: 3_600_000,
  timeZone: "America/Toronto",
};

const response = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("Home Assistant weather", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("combines current conditions, forecasts, and companion sensors", async () => {
    const now = Date.parse("2026-08-08T20:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = new URL(input);
        if (url.pathname === "/api/states/weather.patio") {
          return Promise.resolve(
            response({
              state: "snowy-rainy",
              last_updated: "2026-08-08T19:55:00+00:00",
              attributes: {
                temperature: 20,
                temperature_unit: "°C",
                humidity: 81,
              },
            }),
          );
        }
        if (url.pathname === "/api/states/sun.sun") {
          return Promise.resolve(response({ state: "above_horizon" }));
        }
        if (url.pathname === "/api/states/sensor.patio_humidex") {
          return Promise.resolve(
            response({ state: "25", attributes: { unit_of_measurement: "°C" } }),
          );
        }
        if (url.pathname === "/api/states/sensor.patio_wind_chill") {
          return Promise.resolve(
            response({ state: "unknown", attributes: { unit_of_measurement: "°C" } }),
          );
        }
        if (url.pathname === "/api/states/sensor.patio_precipitation") {
          return Promise.resolve(
            response({ state: "40", attributes: { unit_of_measurement: "%" } }),
          );
        }
        if (url.pathname === "/api/services/weather/get_forecasts") {
          const body = JSON.parse(String(init?.body)) as {
            type: "hourly" | "daily";
          };
          const forecast =
            body.type === "hourly"
              ? [
                  {
                    datetime: "2026-08-08T21:00:00+00:00",
                    condition: "rainy",
                    precipitation_probability: 40,
                    temperature: 19,
                  },
                  {
                    datetime: "2026-08-08T22:00:00+00:00",
                    condition: "snowy-rainy",
                    sunState: "above_horizon",
                    precipitation_probability: 60,
                    temperature: 18,
                  },
                ]
              : [
                  {
                    datetime: "2026-08-08T16:00:00+00:00",
                    condition: "rainy",
                    temperature: null,
                    templow: 14,
                  },
                  {
                    datetime: "2026-08-09T16:00:00+00:00",
                    condition: "sunny",
                    temperature: 26,
                    templow: 14,
                  },
                ];
          return Promise.resolve(
            response({
              service_response: {
                "weather.patio": { forecast },
              },
            }),
          );
        }
        return Promise.reject(new Error(`Unexpected request: ${url.pathname}`));
      }),
    );

    await expect(readHomeAssistantWeather(config, now)).resolves.toEqual({
      condition: "snowy-rainy",
      sunState: "above_horizon",
      temperatureCelsius: 20,
      feelsLikeCelsius: 25,
      precipitationProbability: 60,
      precipitationKind: "mix",
      highCelsius: 26,
      lowCelsius: 14,
      humidityPercent: 81,
      observedAt: "2026-08-08T19:55:00+00:00",
    });
  });
});
