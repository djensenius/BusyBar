import { z } from "zod";

export const BoothStateSchema = z.enum([
  "idle",
  "dialTone",
  "dialing",
  "playingQuestion",
  "beep",
  "recording",
  "uploading",
  "playingMessage",
  "playingInstructions",
  "callUnavailable",
  "error",
]);
export type BoothState = z.infer<typeof BoothStateSchema>;

const RuntimeModeSchema = z.enum(["real", "mock", "simulator"]);

export const BoothStatusSchema = z.object({
  state: BoothStateSchema,
  updatedAt: z.string().datetime(),
  currentQuestionId: z.string().nullable().optional(),
  currentMessageId: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  runtimeMode: RuntimeModeSchema.nullable().optional(),
  firstSeenAt: z.string().datetime().optional(),
  repeatCount: z.number().int().min(1).optional(),
  id: z.number().int().optional(),
});
export type BoothStatus = z.infer<typeof BoothStatusSchema>;

const BoothCpuStatsSchema = z
  .object({
    usageRatio: z.number().min(0).max(1).nullable().optional(),
    perCoreUsageRatio: z.array(z.number().min(0).max(1)).nullable().optional(),
    physicalCores: z.number().int().nonnegative().nullable().optional(),
    loadAvg1m: z.number().nullable().optional(),
  })
  .passthrough();

const BoothMemoryStatsSchema = z
  .object({
    totalBytes: z.number().nonnegative().nullable().optional(),
    usedBytes: z.number().nonnegative().nullable().optional(),
  })
  .passthrough();

const BoothDiskStatsSchema = z
  .object({
    mountPoint: z.string(),
    filesystem: z.string().nullable().optional(),
    totalBytes: z.number().nonnegative(),
    availableBytes: z.number().nonnegative(),
  })
  .passthrough();

const BoothNetworkStatsSchema = z
  .object({
    interface: z.string(),
    receiveBytesTotal: z.number().nonnegative(),
    transmitBytesTotal: z.number().nonnegative(),
    addresses: z.array(z.string()).optional(),
  })
  .passthrough();

const BoothTailscaleStatsSchema = z
  .object({
    connected: z.boolean().nullable().optional(),
    peerCount: z.number().int().nonnegative().nullable().optional(),
    hostname: z.string().nullable().optional(),
  })
  .passthrough();

export const BoothThrottlingFlagsSchema = z
  .object({
    undervoltage: z.boolean().nullable().optional(),
    armFreqCapped: z.boolean().nullable().optional(),
    throttled: z.boolean().nullable().optional(),
    softTempLimit: z.boolean().nullable().optional(),
    undervoltageOccurred: z.boolean().nullable().optional(),
    throttledOccurred: z.boolean().nullable().optional(),
  })
  .passthrough();
export type BoothThrottlingFlags = z.infer<typeof BoothThrottlingFlagsSchema>;

export const BoothSystemSnapshotSchema = z
  .object({
    cpu: BoothCpuStatsSchema.nullable().optional(),
    temperatureCelsius: z.number().nullable().optional(),
    memory: BoothMemoryStatsSchema.nullable().optional(),
    disks: z.array(BoothDiskStatsSchema).nullable().optional(),
    networks: z.array(BoothNetworkStatsSchema).nullable().optional(),
    uptimeSeconds: z.number().nonnegative().nullable().optional(),
    tailscale: BoothTailscaleStatsSchema.nullable().optional(),
    throttling: BoothThrottlingFlagsSchema.nullable().optional(),
    runtimeMode: RuntimeModeSchema.nullable().optional(),
  })
  .passthrough();
export type BoothSystemSnapshot = z.infer<typeof BoothSystemSnapshotSchema>;

export const BoothSystemSnapshotEnvelopeSchema = z.object({
  boothId: z.string(),
  snapshot: BoothSystemSnapshotSchema,
  receivedAt: z.string().datetime(),
  version: z.string().min(1).max(64).nullable().optional(),
});
export type BoothSystemSnapshotEnvelope = z.infer<typeof BoothSystemSnapshotEnvelopeSchema>;

export const MonitorBreakdownTodaySchema = z.object({
  noSelection: z.number().int().nonnegative(),
  wrongNumberAttempts: z.number().int().nonnegative(),
  messagesLeft: z.number().int().nonnegative(),
  messagePlaybackStarts: z.number().int().nonnegative(),
  instructionPlaybackStarts: z.number().int().nonnegative(),
});
export type MonitorBreakdownToday = z.infer<typeof MonitorBreakdownTodaySchema>;

export interface MonitorSummary {
  interactionsToday?: number;
  messagesToday: number;
  interactionsTotal?: number;
  messagesTotal?: number;
  breakdownToday?: MonitorBreakdownToday;
  dayStartedAt: string;
  generatedAt: string;
  timeZone: string;
}

export const MonitorSummarySchema = z
  .object({
    interactionsToday: z.number().int().nonnegative().optional(),
    callsToday: z.number().int().nonnegative().optional(),
    messagesToday: z.number().int().nonnegative(),
    interactionsTotal: z.number().int().nonnegative().optional(),
    callsTotal: z.number().int().nonnegative().optional(),
    messagesTotal: z.number().int().nonnegative().optional(),
    breakdownToday: MonitorBreakdownTodaySchema.optional(),
    dayStartedAt: z.string().datetime(),
    generatedAt: z.string().datetime(),
    timeZone: z.string().min(1).max(64),
  })
  .superRefine((summary, context) => {
    if (
      summary.interactionsToday === undefined &&
      summary.callsToday === undefined &&
      summary.interactionsTotal === undefined &&
      summary.callsTotal === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Monitor summary requires interactionsToday/interactionsTotal or legacy callsToday/callsTotal.",
      });
    }
  })
  .transform((summary): MonitorSummary => {
    const interactionsToday = summary.interactionsToday ?? summary.callsToday;
    const interactionsTotal = summary.interactionsTotal ?? summary.callsTotal;
    const messagesTotal = summary.messagesTotal;
    const breakdownToday = summary.breakdownToday;
    return {
      ...(interactionsToday !== undefined
        ? {
            interactionsToday,
          }
        : {}),
      messagesToday: summary.messagesToday,
      ...(interactionsTotal !== undefined
        ? {
            interactionsTotal,
          }
        : {}),
      ...(messagesTotal !== undefined
        ? {
            messagesTotal,
          }
        : {}),
      ...(breakdownToday !== undefined
        ? {
            breakdownToday,
          }
        : {}),
      dayStartedAt: summary.dayStartedAt,
      generatedAt: summary.generatedAt,
      timeZone: summary.timeZone,
    };
  });

export const WsEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    status: BoothStatusSchema,
  }),
  z.object({
    kind: z.literal("system"),
    boothId: z.string(),
    snapshot: BoothSystemSnapshotSchema,
    receivedAt: z.string().datetime(),
    version: z.string().min(1).max(64).nullable().optional(),
  }),
]);
