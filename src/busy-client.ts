import { BusyBar } from "@busy-app/busy-lib";
import type { BusyBarConfig, DisplayDrawParams } from "@busy-app/busy-lib";
import type { MonitorConfig } from "./config.js";
import { log } from "./logger.js";

export interface BusyBarDeviceClient {
  draw(payload: DisplayDrawParams): Promise<void>;
  clear(applicationName: string): Promise<void>;
  setBrightness(value: number | "auto"): Promise<void>;
  playStockSound(applicationName: string, stockPath: string): Promise<void>;
}

type BusyBarConnectionSource = Pick<
  Extract<MonitorConfig, { enabled: true }>,
  "apiUrl" | "token" | "localUrl" | "localAccessKey"
>;

export interface BusyBarConnectionConfigs {
  cloud: BusyBarConfig;
  local: BusyBarConfig | null;
}

interface NamedBusyBarDeviceClient {
  name: "cloud" | "local";
  client: BusyBarDeviceClient;
}

export const busyBarConnectionConfigs = (
  config: BusyBarConnectionSource,
): BusyBarConnectionConfigs => ({
  cloud: {
    addr: config.apiUrl,
    token: config.token,
    timeout: 5_000,
  },
  local:
    config.localUrl && config.localAccessKey
      ? {
          addr: config.localUrl,
          HTTPAccessPassword: config.localAccessKey,
          timeout: 5_000,
        }
      : null,
});

const deviceClientForBar = (bar: BusyBar): BusyBarDeviceClient => ({
  async draw(payload: DisplayDrawParams): Promise<void> {
    await bar.DisplayDraw(payload);
  },
  async clear(applicationName: string): Promise<void> {
    await bar.DisplayClear({ application_name: applicationName });
  },
  async setBrightness(value: number | "auto"): Promise<void> {
    await bar.DisplayBrightnessSet({ value });
  },
  async playStockSound(applicationName: string, stockPath: string): Promise<void> {
    await bar.AudioPlay({ application_name: applicationName, stock_path: stockPath });
  },
});

export const createFailoverBusyBarDeviceClient = (
  primary: NamedBusyBarDeviceClient,
  secondary: NamedBusyBarDeviceClient,
): BusyBarDeviceClient => {
  let active = primary;

  const execute = async (
    operation: string,
    invoke: (client: BusyBarDeviceClient) => Promise<void>,
  ): Promise<void> => {
    const first = active;
    const second = first === primary ? secondary : primary;
    try {
      await invoke(first.client);
      return;
    } catch (firstError) {
      try {
        await invoke(second.client);
      } catch (secondError) {
        throw new AggregateError(
          [firstError, secondError],
          `BUSY Bar ${operation} failed over ${first.name} and ${second.name}`,
          { cause: secondError },
        );
      }
      active = second;
      log.warn(
        { err: firstError, operation, from: first.name, to: second.name },
        "BUSY Bar display transport failed; switched transport",
      );
    }
  };

  return {
    draw: (payload) => execute("draw", (client) => client.draw(payload)),
    clear: (applicationName) =>
      execute("clear", (client) => client.clear(applicationName)),
    setBrightness: (value) =>
      execute("brightness update", (client) => client.setBrightness(value)),
    playStockSound: (applicationName, stockPath) =>
      execute("audio playback", (client) =>
        client.playStockSound(applicationName, stockPath),
      ),
  };
};

export const createBusyBarDeviceClient = (
  config: Extract<MonitorConfig, { enabled: true }>,
): BusyBarDeviceClient => {
  const connections = busyBarConnectionConfigs(config);
  const cloud = deviceClientForBar(new BusyBar(connections.cloud));
  if (!connections.local) return cloud;
  const local = deviceClientForBar(new BusyBar(connections.local));
  return createFailoverBusyBarDeviceClient(
    { name: "cloud", client: cloud },
    { name: "local", client: local },
  );
};
