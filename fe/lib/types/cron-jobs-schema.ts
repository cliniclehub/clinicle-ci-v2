import { z } from "zod"

export const CRON_JOB_NAMES = [
  "email-queue",
  "auth-cleanup",
  "notification-dispatch",
  "notification-reconcile",
  "cron-history-cleanup",
] as const

export type CronJobName = (typeof CRON_JOB_NAMES)[number]

export const CRON_JOB_STATUS_OPTIONS = ["running", "success", "failed"] as const

export const CronJobRunSchema = z.object({
  id: z.number(),
  jobName: z.string(),
  trigger: z.string(),
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  summary: z.record(z.unknown()).default({}),
  errorMessage: z.string().nullable().optional(),
  hostMetadata: z.record(z.unknown()).nullable().optional(),
  hadWork: z.boolean().nullable().optional(),
})

export type CronJobRun = z.infer<typeof CronJobRunSchema>

export const CronJobRunPruneResultSchema = z.object({
  retentionDays: z.number(),
  cutoffAt: z.string(),
  deletedCount: z.number(),
  preservedLatestPerJob: z.number().optional(),
})

export type CronJobRunPruneResult = z.infer<typeof CronJobRunPruneResultSchema>

export const CronJobSettingSchema = z.object({
  jobName: z.string(),
  displayName: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  intervalSeconds: z.number(),
  updatedAt: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  lastSuccessAt: z.string().nullable().optional(),
  lastFinishedAt: z.string().nullable().optional(),
  lastRunAt: z.string().nullable().optional(),
  lastRunStatus: z.string().nullable().optional(),
  lastHadWork: z.boolean().nullable().optional(),
  nextDueAt: z.string().nullable().optional(),
})

export type CronJobSetting = z.infer<typeof CronJobSettingSchema>

/** True when runs are closer together than ~75% of the configured interval. */
export function isRunningTooFrequently(
  gapSeconds: number,
  configuredIntervalSeconds: number
): boolean {
  return gapSeconds < configuredIntervalSeconds * 0.75
}

export function formatCronInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return `${minutes} min`
  }
  if (seconds < 86400) {
    const hours = Math.round(seconds / 3600)
    return `${hours} hr`
  }
  const days = Math.round(seconds / 86400)
  return `${days} day${days === 1 ? "" : "s"}`
}

export function formatJobSummary(jobName: string, summary: Record<string, unknown>): string {
  switch (jobName) {
    case "email-queue":
      return `sent ${summary.totalProcessed ?? 0}, org errors ${summary.organizationErrors ?? 0}`
    case "auth-cleanup": {
      const deleted = (summary.deleted ?? {}) as Record<string, number>
      const total = Object.values(deleted).reduce((sum, n) => sum + (Number(n) || 0), 0)
      return `deleted ${total} rows`
    }
    case "notification-dispatch":
      return `due ${summary.dueSchedules ?? summary.due_schedules ?? 0}, sent ${summary.sent ?? 0}, failed ${summary.failed ?? 0}`
    case "notification-reconcile":
      return `created ${summary.schedulesCreated ?? summary.schedules_created ?? 0} schedules, errors ${Array.isArray(summary.errors) ? summary.errors.length : 0}`
    case "cron-history-cleanup":
      return `deleted ${summary.deletedCount ?? summary.deleted_count ?? 0} old run rows`
    default:
      return JSON.stringify(summary)
  }
}
