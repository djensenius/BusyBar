import { describe, expect, it } from "vite-plus/test";
import {
  BoothSystemSnapshotSchema,
  MonitorSummarySchema,
  RouterTelemetryListSchema,
} from "../src/schemas.js";

const baseSummary = {
  messagesToday: 8,
  messagesTotal: 80,
  dayStartedAt: "2026-08-08T04:00:00.000Z",
  generatedAt: "2026-08-08T19:00:00.000Z",
  timeZone: "America/Toronto",
};

describe("monitor summary schema", () => {
  it("normalizes legacy call counters into interaction counters", () => {
    expect(
      MonitorSummarySchema.parse({
        ...baseSummary,
        callsToday: 12,
        callsTotal: 120,
      }),
    ).toEqual({
      interactionsToday: 12,
      messagesToday: 8,
      interactionsTotal: 120,
      messagesTotal: 80,
      dayStartedAt: "2026-08-08T04:00:00.000Z",
      generatedAt: "2026-08-08T19:00:00.000Z",
      timeZone: "America/Toronto",
    });
  });

  describe("booth vitals schemas", () => {
    it("parses commanded fan cooling telemetry without requiring RPM", () => {
      expect(
        BoothSystemSnapshotSchema.parse({
          temperatureCelsius: 48.5,
          fan: {
            commandedOn: true,
            pwmRatio: 0.4,
            coolingState: 2,
            maxCoolingState: 4,
          },
        }).fan,
      ).toMatchObject({
        commandedOn: true,
        pwmRatio: 0.4,
        coolingState: 2,
        maxCoolingState: 4,
      });
    });

    it("parses bounded router battery telemetry", () => {
      const sources = RouterTelemetryListSchema.parse([
        {
          boothId: "booth-01",
          componentId: "router",
          displayName: "Travel router",
          latestSnapshot: {
            battery: {
              chargePercent: 78,
              temperatureCelsius: 31.5,
              voltageVolts: 3.88,
              currentAmperes: -0.42,
            },
          },
          capturedAt: "2026-08-20T14:59:59.000Z",
          receivedAt: "2026-08-20T15:00:00.000Z",
        },
      ]);

      expect(sources[0]?.latestSnapshot?.battery?.chargePercent).toBe(78);
      expect(() =>
        RouterTelemetryListSchema.parse([
          {
            boothId: "booth-01",
            componentId: "router",
            displayName: "Travel router",
            latestSnapshot: { battery: { chargePercent: 101 } },
            capturedAt: null,
            receivedAt: null,
          },
        ]),
      ).toThrow();
    });
  });

  it("prefers additive interaction counters when both generations are present", () => {
    expect(
      MonitorSummarySchema.parse({
        ...baseSummary,
        interactionsToday: 14,
        callsToday: 12,
        interactionsTotal: 144,
        callsTotal: 120,
        messagePlaybackStartsTotal: 0,
        breakdownToday: {
          noSelection: 3,
          wrongNumberAttempts: 5,
          messagesLeft: 4,
          messagePlaybackStarts: 7,
          instructionPlaybackStarts: 6,
        },
      }),
    ).toEqual({
      interactionsToday: 14,
      messagesToday: 8,
      interactionsTotal: 144,
      messagesTotal: 80,
      messagePlaybackStartsTotal: 0,
      breakdownToday: {
        noSelection: 3,
        wrongNumberAttempts: 5,
        messagesLeft: 4,
        messagePlaybackStarts: 7,
        instructionPlaybackStarts: 6,
      },
      dayStartedAt: "2026-08-08T04:00:00.000Z",
      generatedAt: "2026-08-08T19:00:00.000Z",
      timeZone: "America/Toronto",
    });
  });

  it("rejects summaries that omit every interaction source", () => {
    expect(() => MonitorSummarySchema.parse(baseSummary)).toThrow(
      "Monitor summary requires interactionsToday/interactionsTotal or legacy callsToday/callsTotal.",
    );
  });
});
