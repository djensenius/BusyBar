import { createBusyBarDeviceClient } from "./busy-client.js";
import { resolveConfig } from "./config.js";
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

  const monitor = new Monitor(config, createBusyBarDeviceClient(config));
  await monitor.start();

  const stream = startOperatorStream(
    config.operatorApiUrl,
    config.operatorToken,
    config.boothId,
    monitor,
  );
  const polling = startOperatorPolling(
    config.operatorApiUrl,
    config.operatorToken,
    config.boothId,
    monitor,
  );
  const summaryPolling = startSummaryPolling(
    config.operatorApiUrl,
    config.operatorToken,
    config.timeZone,
    config.summaryPollIntervalMs,
    monitor,
  );
  const weatherPolling = config.weather
    ? startHomeAssistantWeatherPolling(config.weather, monitor)
    : null;

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    stream.stop();
    polling.stop();
    summaryPolling.stop();
    weatherPolling?.stop();
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
