"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DataTableServerSide } from "@/components/ui/data-table-server-side"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getCronJobRun,
  listCronJobRuns,
  listCronJobSettings,
  pruneCronJobRuns,
  releaseCronJobRun,
  runCronJobNow,
  updateCronJobSetting,
} from "@/lib/actions/cron-jobs-actions"
import {
  CRON_JOB_NAMES,
  CRON_JOB_STATUS_OPTIONS,
  type CronJobRun,
  type CronJobSetting,
  formatCronInterval,
  formatJobSummary,
  isRunningTooFrequently,
} from "@/lib/types/cron-jobs-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { formatDateTime } from "@/lib/utils/date-time-helper"
import { ColumnDef } from "@tanstack/react-table"
import { CheckCircle, Clock, Eye, Loader2, Play, Save, Trash2, XCircle } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

type CronJobsTab = "configuration" | "history"

function parseCronJobsTab(value: string | null): CronJobsTab {
  return value === "history" ? "history" : "configuration"
}

function parseExcludeIdle(value: string | null): boolean {
  return value !== "show"
}

function formatDuration(startedAt: string, finishedAt?: string | null): string {
  if (!finishedAt) return "—"
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
}

function gapSecondsBetween(runs: CronJobRun[], index: number): number | null {
  const current = runs[index]
  const previous = runs[index + 1]
  if (!previous) return null
  return Math.round(
    (new Date(current.startedAt).getTime() - new Date(previous.startedAt).getTime()) / 1000,
  )
}

function gapSincePrevious(
  runs: CronJobRun[],
  index: number,
  intervalSeconds?: number,
): { label: string; tooFrequent: boolean } {
  const gapSec = gapSecondsBetween(runs, index)
  if (gapSec === null) return { label: "—", tooFrequent: false }
  const gapLabel = formatCronInterval(gapSec)
  if (!intervalSeconds) return { label: gapLabel, tooFrequent: false }
  if (isRunningTooFrequently(gapSec, intervalSeconds)) {
    return {
      label: `${gapLabel} (too soon — expected ~${formatCronInterval(intervalSeconds)})`,
      tooFrequent: true,
    }
  }
  if (Math.abs(gapSec - intervalSeconds) <= intervalSeconds * 0.25) {
    return { label: `${gapLabel} (on schedule)`, tooFrequent: false }
  }
  return { label: gapLabel, tooFrequent: false }
}

function detectFrequentRetries(runs: CronJobRun[], intervalSeconds?: number): boolean {
  if (!intervalSeconds || runs.length < 2) return false
  const gap = gapSecondsBetween(runs, 0)
  if (gap === null) return false
  return isRunningTooFrequently(gap, intervalSeconds) && runs[0]?.status === "failed"
}

function getStatusBadge(status: string) {
  const config: Record<
    string,
    {
      variant: "default" | "secondary" | "outline" | "destructive"
      icon: typeof CheckCircle
    }
  > = {
    success: { variant: "default", icon: CheckCircle },
    failed: { variant: "destructive", icon: XCircle },
    running: { variant: "secondary", icon: Loader2 },
  }
  const { variant, icon: Icon } = config[status] ?? {
    variant: "outline",
    icon: Clock,
  }
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

function workBadge(run: CronJobRun) {
  if (run.status !== "success") return null
  if (run.hadWork) {
    return <Badge variant="default">Work done</Badge>
  }
  return <Badge variant="outline">Idle</Badge>
}

function summaryHasErrors(summary: Record<string, unknown>): boolean {
  const errors = summary.errors
  if (Array.isArray(errors)) return errors.length > 0

  const errorCount = summary.errorCount ?? summary.error_count ?? summary.failed
  if (typeof errorCount === "number") return errorCount > 0
  if (typeof errorCount === "string") return Number(errorCount) > 0

  return Boolean(errors)
}

function formatTableOutcome(run: CronJobRun): string {
  if (run.status === "running") return "Running"
  if (run.status === "failed" || run.errorMessage) return "Failed - open details"
  if (summaryHasErrors(run.summary)) return "Completed with errors - open details"

  const summary = formatJobSummary(run.jobName, run.summary)
  if (summary.length > 120 || summary.includes("\n")) {
    return "Summary available in details"
  }
  return summary
}

export function CronJobsList() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabFromUrl = parseCronJobsTab(searchParams.get("tab"))
  const jobFromUrl = searchParams.get("job") || "email-queue"
  const excludeIdleFromUrl = parseExcludeIdle(searchParams.get("idle"))

  const [settings, setSettings] = useState<CronJobSetting[]>([])
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [savingJob, setSavingJob] = useState<string | null>(null)
  const [intervalDrafts, setIntervalDrafts] = useState<Record<string, string>>({})

  const [activeTab, setActiveTab] = useState<CronJobsTab>(tabFromUrl)
  const [selectedJob, setSelectedJob] = useState<string>(jobFromUrl)
  const [runs, setRuns] = useState<CronJobRun[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [excludeIdle, setExcludeIdle] = useState(excludeIdleFromUrl)
  const [selectedRun, setSelectedRun] = useState<CronJobRun | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [releasingRunId, setReleasingRunId] = useState<number | null>(null)
  const [pruneRetentionDays, setPruneRetentionDays] = useState("30")
  const [pruningHistory, setPruningHistory] = useState(false)

  const historyJobNames = settings.length > 0 ? settings.map((s) => s.jobName) : [...CRON_JOB_NAMES]

  const selectedSetting = settings.find((s) => s.jobName === selectedJob)
  const settingsUnavailable = !settingsLoading && settings.length === 0
  const showFrequentRetryWarning = detectFrequentRetries(runs, selectedSetting?.intervalSeconds)

  function updateCronJobsUrl(nextTab: CronJobsTab, nextJob: string, nextExcludeIdle = excludeIdle) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", nextTab)
    params.set("job", nextJob)
    if (nextExcludeIdle) {
      params.delete("idle")
    } else {
      params.set("idle", "show")
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function handleTabChange(value: string) {
    const nextTab = parseCronJobsTab(value)
    setActiveTab(nextTab)
    updateCronJobsUrl(nextTab, selectedJob)
  }

  function handleSelectedJobChange(jobName: string, tab: CronJobsTab = activeTab) {
    setSelectedJob(jobName)
    setCurrentPage(1)
    updateCronJobsUrl(tab, jobName)
  }

  function handleExcludeIdleChange(checked: boolean) {
    setExcludeIdle(checked)
    setCurrentPage(1)
    updateCronJobsUrl(activeTab, selectedJob, checked)
  }

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    const result = await listCronJobSettings()
    if (handleApiErrorResponse(result, "Failed to load cron job settings")) {
      setSettingsLoading(false)
      return
    }
    if (result.status === "success" && result.data) {
      setSettings(result.data)
      const drafts: Record<string, string> = {}
      for (const row of result.data) {
        drafts[row.jobName] = String(Math.round(row.intervalSeconds / 60))
      }
      setIntervalDrafts(drafts)
    }
    setSettingsLoading(false)
  }, [])

  const loadRuns = useCallback(async () => {
    setLoading(true)
    const result = await listCronJobRuns({
      page: currentPage,
      pageSize,
      jobName: selectedJob,
      status: statusFilter !== "all" ? statusFilter : undefined,
      excludeIdle,
    })

    if (handleApiErrorResponse(result, "Failed to load cron job runs")) {
      setLoading(false)
      return
    }

    if (result.status === "success" && result.data) {
      setRuns(result.data)
      setTotal(result.pagination?.totalItems ?? 0)
    }
    setLoading(false)
  }, [currentPage, pageSize, selectedJob, statusFilter, excludeIdle])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  useEffect(() => {
    setActiveTab(tabFromUrl)
  }, [tabFromUrl])

  useEffect(() => {
    setSelectedJob((current) => {
      if (current !== jobFromUrl) {
        setCurrentPage(1)
      }
      return jobFromUrl
    })
  }, [jobFromUrl])

  useEffect(() => {
    setExcludeIdle(excludeIdleFromUrl)
  }, [excludeIdleFromUrl])

  async function handleToggleEnabled(job: CronJobSetting, enabled: boolean) {
    setSavingJob(job.jobName)
    const result = await updateCronJobSetting(job.jobName, { enabled })
    setSavingJob(null)
    if (handleApiErrorResponse(result, "Failed to update cron job")) return
    if (result.status === "success" && result.data) {
      setSettings((prev) => prev.map((row) => (row.jobName === job.jobName ? result.data! : row)))
      toast.success(`${job.displayName} ${enabled ? "enabled" : "disabled"}`)
    }
  }

  async function handleSaveInterval(job: CronJobSetting) {
    const minutes = Number(intervalDrafts[job.jobName])
    if (!Number.isFinite(minutes) || minutes < 1) {
      toast.error("Interval must be at least 1 minute")
      return
    }
    setSavingJob(job.jobName)
    const result = await updateCronJobSetting(job.jobName, {
      intervalSeconds: Math.round(minutes * 60),
    })
    setSavingJob(null)
    if (handleApiErrorResponse(result, "Failed to update interval")) return
    if (result.status === "success" && result.data) {
      setSettings((prev) => prev.map((row) => (row.jobName === job.jobName ? result.data! : row)))
      toast.success(`Updated ${job.displayName} interval`)
    }
  }

  async function openDetail(run: CronJobRun) {
    setSelectedRun(run)
    setDetailOpen(true)
    setDetailLoading(true)
    const result = await getCronJobRun(run.id)
    setDetailLoading(false)
    if (result.status === "success" && result.data) {
      setSelectedRun(result.data)
    }
  }

  async function handleRunJobNow(jobName: string) {
    setRunningJob(jobName)
    const result = await runCronJobNow(jobName)
    setRunningJob(null)

    if (handleApiErrorResponse(result, "Failed to run cron job")) {
      return
    }

    if (result.status === "success" && result.data) {
      const run = result.data
      handleSelectedJobChange(jobName)
      await loadSettings()
      const runsResult = await listCronJobRuns({
        page: 1,
        pageSize,
        jobName,
        status: statusFilter !== "all" ? statusFilter : undefined,
        excludeIdle,
      })
      if (runsResult.status === "success" && runsResult.data) {
        setRuns(runsResult.data)
        setTotal(runsResult.pagination?.totalItems ?? 0)
      }
      if (run.status === "success") {
        toast.success(`${jobName} completed — run #${run.id} logged`)
      } else {
        toast.error(`${jobName} failed — see run #${run.id} in history`)
      }
      await openDetail(run)
    }
  }

  async function handleReleaseRun(run: CronJobRun) {
    setReleasingRunId(run.id)
    const result = await releaseCronJobRun(run.id)
    setReleasingRunId(null)

    if (handleApiErrorResponse(result, "Failed to release cron run")) {
      return
    }

    if (result.status === "success" && result.data) {
      const released = result.data
      setRuns((prev) => prev.map((row) => (row.id === released.id ? released : row)))
      if (selectedRun?.id === released.id) {
        setSelectedRun(released)
      }
      await loadSettings()
      await loadRuns()
      toast.success(`Released ${released.jobName} run #${released.id}`)
    }
  }

  async function handlePruneHistory() {
    const trimmedDays = pruneRetentionDays.trim()
    const days = Number(trimmedDays)
    if (!trimmedDays || !Number.isInteger(days) || days < 0 || days > 3650) {
      toast.error("Retention days must be a whole number from 0 to 3650")
      return
    }

    setPruningHistory(true)
    const result = await pruneCronJobRuns(days)
    setPruningHistory(false)

    if (handleApiErrorResponse(result, "Failed to clean cron history")) {
      return
    }

    if (result.status === "success" && result.data) {
      await loadSettings()
      await loadRuns()
      toast.success(`Deleted ${result.data.deletedCount} cron run row(s)`)
    }
  }

  function renderPruneHistoryButton() {
    const days = Number(pruneRetentionDays.trim())
    const isDangerousAllHistory = Number.isInteger(days) && days === 0

    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={pruningHistory}
          >
            {pruningHistory ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-4 w-4" />
            )}
            Clean history
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clean cron run history?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes completed cron run rows older than{" "}
              <span className="font-medium">{pruneRetentionDays || "0"} day(s)</span>. Running jobs
              and each job&apos;s latest completed row are preserved.{" "}
              {isDangerousAllHistory
                ? "A value of 0 deletes all older completed history before now."
                : "Recent history remains available."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handlePruneHistory}
            >
              Delete history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  function renderRunNowButton(jobName: string, variant: "default" | "outline" = "outline") {
    const isRunning = runningJob === jobName

    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant={variant}
            disabled={isRunning || runningJob !== null}
            onClick={(e) => e.stopPropagation()}
          >
            {isRunning ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1 h-4 w-4" />
            )}
            Run now
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {jobName} now?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs the real job immediately, outside its normal schedule. It uses the same code
              path as Render Cron and writes a manual entry to run history. The job runs even if it
              is currently disabled in settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleRunJobNow(jobName)}>Run job</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  function renderReleaseRunButton(run: CronJobRun) {
    if (run.status !== "running") return null
    const isReleasing = releasingRunId === run.id

    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={isReleasing}
            onClick={(e) => e.stopPropagation()}
          >
            {isReleasing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-1 h-4 w-4" />
            )}
            Release
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Release run #{run.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the running row as failed so the dispatcher can schedule{" "}
              <span className="font-mono">{run.jobName}</span> again. It does not kill an
              operating-system process that might still be running outside DB tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => handleReleaseRun(run)}
            >
              Release run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  const columns: ColumnDef<CronJobRun>[] = [
    {
      accessorKey: "startedAt",
      header: "Started",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm">{formatDateTime(row.original.startedAt)}</span>
      ),
    },
    {
      accessorKey: "finishedAt",
      header: "Finished",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm">
          {row.original.finishedAt ? formatDateTime(row.original.finishedAt) : "—"}
        </span>
      ),
    },
    {
      id: "gap",
      header: "Since previous run",
      cell: ({ row }) => {
        const gap = gapSincePrevious(runs, row.index, selectedSetting?.intervalSeconds)
        return (
          <span
            className={`text-sm ${gap.tooFrequent ? "font-medium text-destructive" : "text-muted-foreground"}`}
          >
            {gap.label}
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {getStatusBadge(row.original.status)}
          {workBadge(row.original)}
        </div>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      cell: ({ row }) => formatDuration(row.original.startedAt, row.original.finishedAt),
    },
    {
      id: "summary",
      header: "Outcome",
      cell: ({ row }) => {
        const outcome = formatTableOutcome(row.original)
        return (
          <div className="max-w-[18rem] truncate text-sm text-muted-foreground" title={outcome}>
            {outcome}
          </div>
        )
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          {renderReleaseRunButton(row.original)}
          <Button variant="ghost" size="sm" onClick={() => openDetail(row.original)}>
            <Eye className="mr-1 h-4 w-4" />
            Details
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="configuration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Job configuration</CardTitle>
              <CardDescription>
                Enable or disable jobs and set how often each runs. The dispatcher reads these
                database settings on each loop tick.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settingsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Next due</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settings.map((job) => (
                      <TableRow
                        key={job.jobName}
                        className="cursor-pointer"
                        data-state={selectedJob === job.jobName ? "selected" : undefined}
                        onClick={() => {
                          handleSelectedJobChange(job.jobName)
                        }}
                      >
                        <TableCell className="min-w-[280px]">
                          <div className="space-y-1">
                            <p className="font-medium">{job.displayName}</p>
                            <p className="font-mono text-xs text-muted-foreground">{job.jobName}</p>
                            <p className="max-w-xl text-xs text-muted-foreground">
                              {job.description}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Switch
                              aria-label={`${job.enabled ? "Disable" : "Enable"} ${job.displayName}`}
                              checked={job.enabled}
                              disabled={savingJob === job.jobName}
                              onCheckedChange={(checked) => handleToggleEnabled(job, checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-sm text-muted-foreground">
                              {job.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[190px]">
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Label htmlFor={`interval-${job.jobName}`} className="sr-only">
                              Interval minutes for {job.displayName}
                            </Label>
                            <Input
                              id={`interval-${job.jobName}`}
                              type="number"
                              min={1}
                              value={intervalDrafts[job.jobName] ?? ""}
                              disabled={!job.enabled || savingJob === job.jobName}
                              className="w-24"
                              onChange={(e) =>
                                setIntervalDrafts((prev) => ({
                                  ...prev,
                                  [job.jobName]: e.target.value,
                                }))
                              }
                            />
                            <span className="text-sm text-muted-foreground">min</span>
                            <Button
                              aria-label={`Save interval for ${job.displayName}`}
                              size="sm"
                              variant="outline"
                              disabled={!job.enabled || savingJob === job.jobName}
                              onClick={() => handleSaveInterval(job)}
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {job.lastRunAt ? (
                            <div className="space-y-1">
                              <p>{formatDateTime(job.lastRunAt)}</p>
                              {job.lastRunStatus && getStatusBadge(job.lastRunStatus)}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {job.enabled && job.nextDueAt ? (
                            formatDateTime(job.nextDueAt)
                          ) : job.enabled ? (
                            <span className="text-muted-foreground">As soon as dispatcher runs</span>
                          ) : (
                            <span className="text-muted-foreground">Disabled</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {renderRunNowButton(job.jobName)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {settingsUnavailable && (
                <p className="text-sm text-muted-foreground">
                  Job settings could not be loaded. Apply migration{" "}
                  <code className="text-xs">094_cron_job_settings.sql</code> and redeploy the
                  backend.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Run history</CardTitle>
              <CardDescription>
                Pick one job to review its runs. Long errors and full diagnostic payloads stay in
                Details so the table remains readable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor="history-job">Job</Label>
                  <Select
                    value={selectedJob}
                    onValueChange={(value) => handleSelectedJobChange(value, "history")}
                  >
                    <SelectTrigger id="history-job" className="w-[280px]">
                      <SelectValue placeholder="Select job" />
                    </SelectTrigger>
                    <SelectContent>
                      {historyJobNames.map((name) => {
                        const setting = settings.find((s) => s.jobName === name)
                        return (
                          <SelectItem key={name} value={name}>
                            {setting?.displayName ?? name}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                {selectedSetting && renderRunNowButton(selectedSetting.jobName, "default")}
              </div>

              {selectedSetting && (
                <div className="mb-4 space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p>
                      <span className="font-medium">{selectedSetting.displayName}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — configured every {formatCronInterval(selectedSetting.intervalSeconds)}
                        {selectedSetting.enabled ? "" : " (disabled)"}
                      </span>
                    </p>
                  </div>
                  <p className="text-muted-foreground">
                    Last started:{" "}
                    {selectedSetting.lastRunAt
                      ? formatDateTime(selectedSetting.lastRunAt)
                      : "Never"}
                    {selectedSetting.lastRunStatus ? ` (${selectedSetting.lastRunStatus})` : ""}
                    {" · "}
                    Next due:{" "}
                    {selectedSetting.enabled && selectedSetting.nextDueAt
                      ? formatDateTime(selectedSetting.nextDueAt)
                      : selectedSetting.enabled
                        ? "After first run"
                        : "—"}
                  </p>
                  {showFrequentRetryWarning && (
                    <p className="text-destructive">
                      Runs are appearing more often than the configured interval. This usually means
                      the job is failing and was being retried on every dispatcher tick (~5 min).
                      Deploy the latest backend fix, or disable this job until the underlying error
                      is resolved.
                    </p>
                  )}
                </div>
              )}

              <DataTableServerSide
                columns={columns}
                data={runs}
                searchKey="jobName"
                searchPlaceholder="Selected job only"
                pageSize={pageSize}
                pageSizeOptions={[10, 20, 50, 100]}
                totalItems={total}
                currentPage={currentPage}
                isLoading={loading}
                enableRowSelection={false}
                onPageChange={setCurrentPage}
                onSortChange={() => {}}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  setCurrentPage(1)
                }}
                onSearchChange={() => {}}
                onFilterChange={() => {}}
                toolbarActions={
                  <div className="flex flex-wrap items-center gap-4">
                    <Select
                      value={statusFilter}
                      onValueChange={(v) => {
                        setStatusFilter(v)
                        setCurrentPage(1)
                      }}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {CRON_JOB_STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="exclude-idle"
                        checked={excludeIdle}
                        onCheckedChange={(checked) => handleExcludeIdleChange(checked === true)}
                      />
                      <Label htmlFor="exclude-idle" className="text-sm font-normal">
                        Hide idle runs (no work done)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="history-retention-days" className="text-sm font-normal">
                        Keep days
                      </Label>
                      <Input
                        id="history-retention-days"
                        type="number"
                        min={0}
                        max={3650}
                        value={pruneRetentionDays}
                        disabled={pruningHistory}
                        className="h-9 w-20"
                        onChange={(event) => setPruneRetentionDays(event.target.value)}
                      />
                      {renderPruneHistoryButton()}
                    </div>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Run #{selectedRun?.id} — {selectedRun?.jobName}
            </DialogTitle>
            <DialogDescription>
              Started {selectedRun?.startedAt ? formatDateTime(selectedRun.startedAt) : "—"}
              {selectedRun?.finishedAt &&
                ` · Finished ${formatDateTime(selectedRun.finishedAt)} · ${formatDuration(
                  selectedRun.startedAt,
                  selectedRun.finishedAt,
                )}`}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedRun ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {getStatusBadge(selectedRun.status)}
                {workBadge(selectedRun)}
                <Badge variant="outline">Trigger: {selectedRun.trigger}</Badge>
                {renderReleaseRunButton(selectedRun)}
              </div>
              {selectedRun.errorMessage && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-destructive">Error</h4>
                  <pre className="max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive [overflow-wrap:anywhere]">
                    {selectedRun.errorMessage}
                  </pre>
                </div>
              )}
              <div>
                <h4 className="mb-2 text-sm font-semibold">Summary</h4>
                <pre className="max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs [overflow-wrap:anywhere]">
                  {JSON.stringify(selectedRun.summary, null, 2)}
                </pre>
              </div>
              {selectedRun.hostMetadata && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Host metadata</h4>
                  <pre className="max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs [overflow-wrap:anywhere]">
                    {JSON.stringify(selectedRun.hostMetadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
