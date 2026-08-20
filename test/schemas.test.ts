import { describe, expect, it } from "vite-plus/test";
import { MonitorSummarySchema } from "../src/schemas.js";

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

  it("prefers additive interaction counters when both generations are present", () => {
    expect(
      MonitorSummarySchema.parse({
        ...baseSummary,
        interactionsToday: 14,
        callsToday: 12,
        interactionsTotal: 144,
        callsTotal: 120,
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
