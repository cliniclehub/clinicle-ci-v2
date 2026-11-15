"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import { CronJobRun, CronJobRunPruneResult, CronJobSetting } from "@/lib/types/cron-jobs-schema"
import { PLATFORM_SETTINGS_MANAGE } from "@/lib/types/permission-schema"
import { apiCaller } from "@/lib/utils/api-caller-helper"

export async function runCronJobNow(jobName: string): Promise<ApiResponse<CronJobRun>> {
  return apiCaller.post<CronJobRun>(`/cron-jobs/jobs/${jobName}/run`, {}, {
    requireAuth: true,
    requirePermission: PLATFORM_SETTINGS_MANAGE,
  })
}

export async function listCronJobSettings(): Promise<ApiResponse<CronJobSetting[]>> {
  return apiCaller.get<CronJobSetting[]>("/cron-jobs/settings", {
    requireAuth: true,
    requirePermission: PLATFORM_SETTINGS_MANAGE,
    cache: "no-store",
  })
}

export async function updateCronJobSetting(
  jobName: string,
  payload: { enabled?: boolean; intervalSeconds?: number }
): Promise<ApiResponse<CronJobSetting>> {
  return apiCaller.patch<CronJobSetting>(`/cron-jobs/settings/${jobName}`, payload, {
    requireAuth: true,
    requirePermission: PLATFORM_SETTINGS_MANAGE,
  })
}

export async function listCronJobRuns(params: {
  page?: number
  pageSize?: number
  jobName?: string
  status?: string
  startedAfter?: string
  startedBefore?: string
  excludeIdle?: boolean
}): Promise<ApiResponse<CronJobRun[]>> {
  const queryParams = new URLSearchParams()
  if (params.page) queryParams.append("page", params.page.toString())
  if (params.pageSize) queryParams.append("page_size", params.pageSize.toString())
  if (params.jobName) queryParams.append("job_name", params.jobName)
  if (params.status) queryParams.append("status", params.status)
  if (params.startedAfter) queryParams.append("started_after", params.startedAfter)
  if (params.startedBefore) queryParams.append("started_before", params.startedBefore)
  if (params.excludeIdle) queryParams.append("exclude_idle", "true")

  return apiCaller.get<CronJobRun[]>(
    `/cron-jobs/runs?${queryParams.toString()}`,
    { requireAuth: true, requirePermission: PLATFORM_SETTINGS_MANAGE, cache: "no-store" }
  )
}

export async function getCronJobRun(runId: number): Promise<ApiResponse<CronJobRun>> {
  return apiCaller.get<CronJobRun>(`/cron-jobs/runs/${runId}`, {
    requireAuth: true,
    requirePermission: PLATFORM_SETTINGS_MANAGE,
    cache: "no-store",
  })
}

export async function releaseCronJobRun(runId: number): Promise<ApiResponse<CronJobRun>> {
  return apiCaller.post<CronJobRun>(`/cron-jobs/runs/${runId}/release`, {}, {
    requireAuth: true,
    requirePermission: PLATFORM_SETTINGS_MANAGE,
  })
}

export async function pruneCronJobRuns(retentionDays: number): Promise<ApiResponse<CronJobRunPruneResult>> {
  return apiCaller.post<CronJobRunPruneResult>(
    "/cron-jobs/runs/prune",
    { retentionDays },
    {
      requireAuth: true,
      requirePermission: PLATFORM_SETTINGS_MANAGE,
    },
  )
}
