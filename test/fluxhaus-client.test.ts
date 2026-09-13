import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { FluxHausConfig } from "../src/config.js";
import {
  parseFluxHausSnapshot,
  readFluxHausSnapshot,
  startFluxHausPolling,
} from "../src/fluxhaus-client.js";

const config: FluxHausConfig = {
  url: "https://haus.example.com",
  username: "demo",
  password: "secret",
  pollIntervalMs: 10_000,
  staleAfterMs: 120_000,
};

const payload = {
  timestamp: "2026-09-12T17:00:00.000Z",
  washer: {
    timeRunning: 22,
    timeRemaining: 38,
    step: "Rinse",
    programName: "Cottons",
    status: "Running",
    inUse: true,
  },
  dryer: {
    timeRemaining: 0,
    status: "End programmed",
    inUse: true,
  },
  dishwasher: {
    status: "Running",
    remainingTime: 4_320,
    remainingTimeUnit: "seconds",
    programProgress: 28,
    operationState: "Run",
    activeProgram: "Eco50",
  },
  broombot: {
    running: true,
    docking: false,
    batteryLevel: 84,
    timestamp: "2026-09-12T16:59:55.000Z",
  },
  mopbot: {
    running: false,
    docking: true,
    batteryLevel: 22,
    timestamp: "2026-09-12T16:59:55.000Z",
  },
  airPurifier: {
    timestamp: "2026-09-12T16:59:00.000Z",
    online: true,
    fanOn: true,
    fanSpeed: 42,
    presetMode: "auto",
    pm25: 8,
  },
  carEvStatus: {
    timestamp: "2026-09-12T16:48:00.000Z",
    batteryCharge: true,
    batteryStatus: 78,
    drvDistance: [
      {
        rangeByFuel: {
          evModeRange: { value: 356 },
          totalAvailableRange: { value: 356 },
        },
      },
    ],
  },
};

describe("FluxHaus client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("normalizes equipment and car status", () => {
    expect(parseFluxHausSnapshot(payload)).toEqual({
      generatedAt: "2026-09-12T17:00:00.000Z",
      devices: [
        {
          id: "washer",
          name: "Washer",
          active: true,
          lifecycle: "active",
          status: "Running",
          detail: "Rinse",
          progressPercent: 36.666666666666664,
          remainingSeconds: 2_280,
          elapsedSeconds: null,
          batteryPercent: null,
          updatedAt: null,
        },
        {
          id: "dryer",
          name: "Dryer",
          active: false,
          lifecycle: "finished",
          status: "End programmed",
          detail: null,
          progressPercent: null,
          remainingSeconds: 0,
          elapsedSeconds: null,
          batteryPercent: null,
          updatedAt: null,
        },
        {
          id: "dishwasher",
          name: "Dishwasher",
          active: true,
          lifecycle: "active",
          status: "Running",
          detail: "Eco50",
          progressPercent: 28,
          remainingSeconds: 4_320,
          elapsedSeconds: null,
          batteryPercent: null,
          updatedAt: null,
        },
        {
          id: "broombot",
          name: "BroomBot",
          active: true,
          lifecycle: "active",
          status: "Cleaning",
          detail: null,
          progressPercent: null,
          remainingSeconds: null,
          elapsedSeconds: null,
          batteryPercent: 84,
          updatedAt: "2026-09-12T16:59:55.000Z",
        },
        {
          id: "mopbot",
          name: "MopBot",
          active: true,
          lifecycle: "active",
          status: "Returning",
          detail: null,
          progressPercent: null,
          remainingSeconds: null,
          elapsedSeconds: null,
          batteryPercent: 22,
          updatedAt: "2026-09-12T16:59:55.000Z",
        },
        {
          id: "airPurifier",
          name: "Air purifier",
          active: true,
          lifecycle: "active",
          status: "Running",
          detail: "auto PM8",
          progressPercent: 42,
          remainingSeconds: null,
          elapsedSeconds: null,
          batteryPercent: null,
          updatedAt: "2026-09-12T16:59:00.000Z",
        },
      ],
      car: {
        batteryPercent: 78,
        evRangeKm: 356,
        totalRangeKm: 356,
        charging: true,
        updatedAt: "2026-09-12T16:48:00.000Z",
      },
    });
  });

  it("accepts partial snapshots without inventing missing devices", () => {
    expect(
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        washer: null,
        carEvStatus: null,
      }),
    ).toEqual({
      devices: [],
      car: null,
      generatedAt: "2026-09-12T17:00:00.000Z",
    });
  });

  it("keeps paused and incomplete running telemetry non-terminal", () => {
    const snapshot = parseFluxHausSnapshot({
      timestamp: "2026-09-12T17:00:00.000Z",
      washer: {
        status: "Running",
        inUse: true,
      },
      dishwasher: {
        operationState: "Run",
      },
      broombot: {
        running: false,
        paused: true,
        batteryLevel: 50,
        timestamp: "2026-09-12T16:59:55.000Z",
      },
    });

    expect(snapshot.devices).toMatchObject([
      { id: "washer", active: false, lifecycle: "unknown" },
      { id: "dishwasher", active: false, lifecycle: "unknown" },
      { id: "broombot", active: false, lifecycle: "paused", status: "Paused" },
    ]);
  });

  it("keeps delayed appliances and incomplete robots non-terminal", () => {
    const snapshot = parseFluxHausSnapshot({
      timestamp: "2026-09-12T17:00:00.000Z",
      washer: {
        status: "Waiting to start",
        inUse: true,
        timeRemaining: 30,
      },
      broombot: {
        docking: false,
        batteryLevel: 50,
      },
    });

    expect(snapshot.devices).toMatchObject([
      { id: "washer", active: false, lifecycle: "unknown" },
      { id: "broombot", active: false, lifecycle: "unknown", status: "Unknown" },
    ]);
  });

  it("keeps unknown dishwasher states non-terminal", () => {
    expect(
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        dishwasher: {
          operationState: "Error",
          programProgress: 50,
        },
      }).devices[0],
    ).toMatchObject({
      id: "dishwasher",
      active: false,
      lifecycle: "unknown",
    });
  });

  it("omits incomplete car data without discarding equipment", () => {
    expect(
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        washer: payload.washer,
        carEvStatus: { batteryCharge: true },
      }),
    ).toMatchObject({
      devices: [{ id: "washer", active: true }],
      car: null,
    });
  });

  it("preserves robot elapsed time when battery is unavailable", () => {
    expect(
      parseFluxHausSnapshot(
        {
          timestamp: "2026-09-12T17:00:00.000Z",
          broombot: {
            running: true,
            timeStarted: "2026-09-12T16:45:00.000Z",
          },
        },
        new Date("2026-09-12T17:00:00.000Z"),
      ).devices[0],
    ).toMatchObject({
      id: "broombot",
      active: true,
      elapsedSeconds: 900,
      batteryPercent: null,
    });
  });

  it("uses fan state when purifier online telemetry is absent", () => {
    expect(
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        airPurifier: { fanOn: true, fanSpeed: 25 },
      }).devices[0],
    ).toMatchObject({
      id: "airPurifier",
      active: true,
      lifecycle: "active",
      status: "Running",
    });
  });

  it("rejects out-of-range percentages", () => {
    expect(() =>
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        broombot: { running: true, batteryLevel: 101 },
      }),
    ).toThrow();
  });

  it("preserves a legitimate zero EV range", () => {
    expect(
      parseFluxHausSnapshot({
        timestamp: "2026-09-12T17:00:00.000Z",
        carEvStatus: {
          timestamp: "2026-09-12T16:48:00.000Z",
          batteryStatus: 0,
          drvDistance: [
            {
              rangeByFuel: {
                evModeRange: { value: 0 },
                totalAvailableRange: { value: 400 },
              },
            },
          ],
        },
      }).car,
    ).toMatchObject({
      batteryPercent: 0,
      evRangeKm: 0,
      totalRangeKm: 400,
    });
  });

  it("uses read-only Basic auth and reports HTTP failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFluxHausSnapshot(config)).resolves.toMatchObject({
      car: { batteryPercent: 78 },
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: `Basic ${Buffer.from("demo:secret").toString("base64")}`,
        accept: "application/json",
      },
    });
    await expect(readFluxHausSnapshot(config)).rejects.toThrow(
      "FluxHaus API returned 401 for /",
    );
  });

  it("uses a bounded request timeout", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await readFluxHausSnapshot(config);

    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeoutSignal);
  });

  it("does not overlap polls", async () => {
    vi.useFakeTimers();
    let resolveFetch: (response: Response) => void = () => {
      throw new Error("Fetch promise was not initialized");
    };
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const monitor = { updateFluxHaus: vi.fn() };

    const feed = startFluxHausPolling(config, monitor);
    await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 2);
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveFetch(new Response(JSON.stringify(payload), { status: 200 }));
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    feed.stop();
  });
});
