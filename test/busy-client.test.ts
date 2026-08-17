import { describe, expect, it, vi } from "vite-plus/test";
import type { BusyBarDeviceClient } from "../src/busy-client.js";
import {
  busyBarConnectionConfigs,
  createFailoverBusyBarDeviceClient,
} from "../src/busy-client.js";

const createClient = (): BusyBarDeviceClient & {
  clear: ReturnType<typeof vi.fn>;
  setBrightness: ReturnType<typeof vi.fn>;
} => ({
  draw: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
  setBrightness: vi.fn(() => Promise.resolve()),
  playStockSound: vi.fn(() => Promise.resolve()),
});

describe("BUSY Bar device client", () => {
  it("configures both cloud and authenticated local transports", () => {
    expect(
      busyBarConnectionConfigs({
        apiUrl: "https://api.busy.app",
        token: "cloud-token",
        localUrl: "http://192.168.1.247",
        localAccessKey: "1234567890",
      }),
    ).toEqual({
      cloud: {
        addr: "https://api.busy.app",
        token: "cloud-token",
        timeout: 5_000,
      },
      local: {
        addr: "http://192.168.1.247",
        HTTPAccessPassword: "1234567890",
        timeout: 5_000,
      },
    });
  });

  it("switches to the local transport after a cloud failure", async () => {
    const cloud = createClient();
    const local = createClient();
    cloud.clear.mockRejectedValueOnce(new Error("Service unavailable"));
    const client = createFailoverBusyBarDeviceClient(
      { name: "cloud", client: cloud },
      { name: "local", client: local },
    );

    await client.clear("telephone-booth-monitor");
    await client.setBrightness(5);

    expect(cloud.clear).toHaveBeenCalledTimes(1);
    expect(local.clear).toHaveBeenCalledTimes(1);
    expect(cloud.setBrightness).not.toHaveBeenCalled();
    expect(local.setBrightness).toHaveBeenCalledWith(5);
  });
});
