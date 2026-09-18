import {
  createBusyBarDeviceClient,
  createBusyBarLocalUrlResolver,
} from "./busy-client.js";
import { resolveConfig } from "./config.js";
import { createHomeAssistantSceneClient } from "./home-assistant-client.js";
import { startFluxHausPolling } from "./fluxhaus-client.js";
import { log } from "./logger.js";
import { Monitor } from "./monitor.js";
import {
  startOperatorPolling,
  startOperatorStream,
  startSummaryPolling,
} from "./operator-client.js";
import { startHomeAssistantWeatherPolling } from "./weather-client.js";

const waitWhileDisabled = (): Promise<void> =>
  new Promise((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);
    const shutdown = (): void => {
      clearInterval(keepAlive);
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      resolve();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });

export const start = async (): Promise<void> => {
  const config = resolveConfig();
  if (!config.enabled) {
    log.info("BUSY Bar monitor is disabled; waiting for shutdown");
    await waitWhileDisabled();
    return;
  }

  const resolveLocalUrl = createBusyBarLocalUrlResolver(config);
  const localUrl = await resolveLocalUrl?.();
  const runtimeConfig =
    localUrl && localUrl !== config.localUrl ? { ...config, localUrl } : config;
  const monitor = new Monitor(
    runtimeConfig,
    createBusyBarDeviceClient(runtimeConfig),
    runtimeConfig.homeAssistant
      ? createHomeAssistantSceneClient(runtimeConfig.homeAssistant)
      : null,
    resolveLocalUrl,
  );
  await monitor.start();

  const stream = startOperatorStream(
    runtimeConfig.operatorApiUrl,
    runtimeConfig.operatorToken,
    runtimeConfig.boothId,
    monitor,
  );
  const polling = startOperatorPolling(
    runtimeConfig.operatorApiUrl,
    runtimeConfig.operatorToken,
    runtimeConfig.boothId,
    monitor,
  );
  const summaryPolling = startSummaryPolling(
    runtimeConfig.operatorApiUrl,
    runtimeConfig.operatorToken,
    runtimeConfig.timeZone,
    runtimeConfig.summaryPollIntervalMs,
    monitor,
  );
  const weatherPolling = runtimeConfig.weather
    ? startHomeAssistantWeatherPolling(runtimeConfig.weather, monitor)
    : null;
  const fluxHausPolling = runtimeConfig.fluxHaus
    ? startFluxHausPolling(runtimeConfig.fluxHaus, monitor)
    : null;

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    stream.stop();
    polling.stop();
    summaryPolling.stop();
    weatherPolling?.stop();
    fluxHausPolling?.stop();
    void monitor.stop().finally(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
};

void start().catch((error: unknown) => {
  log.error({ err: error }, "BUSY Bar monitor failed to start");
  process.exitCode = 1;
});
