"use client"

import { CronJobsList } from "@/components/cron-jobs/cron-jobs-list"

export default function PlatformCronJobsPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Cron Jobs</h2>
        <p className="text-muted-foreground mt-1">
          Configure background jobs and review run history per job
        </p>
      </div>
      <CronJobsList />
    </div>
  )
}
