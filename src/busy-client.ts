import { BusyBar } from "@busy-app/busy-lib";
import type { DisplayDrawParams } from "@busy-app/busy-lib";
import type { MonitorConfig } from "./config.js";

export interface BusyBarDeviceClient {
  draw(payload: DisplayDrawParams): Promise<void>;
  clear(applicationName: string): Promise<void>;
  setBrightness(value: number | "auto"): Promise<void>;
  playStockSound(applicationName: string, stockPath: string): Promise<void>;
}

export const createBusyBarDeviceClient = (
  config: Extract<MonitorConfig, { enabled: true }>,
): BusyBarDeviceClient => {
  const bar = new BusyBar({ addr: config.apiUrl, token: config.token, timeout: 5_000 });
  return {
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
  };
};
