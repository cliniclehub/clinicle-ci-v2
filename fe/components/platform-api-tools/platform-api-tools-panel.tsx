"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getPlatformDatabaseHealth,
  getPlatformHealth,
  getPlatformPoolHealth,
} from "@/lib/actions/platform-api-tools-actions"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

const DOC_LINKS = [
  { label: "Swagger UI", href: "/api/platform/devtools/docs" },
  { label: "ReDoc", href: "/api/platform/devtools/redoc" },
  { label: "OpenAPI JSON", href: "/api/platform/devtools/openapi.json" },
] as const

const HEALTH_LINKS = [
  { label: "Overall health", href: "/api/platform/devtools/health" },
  { label: "Database health", href: "/api/platform/devtools/health/database" },
  { label: "Connection pool", href: "/api/platform/devtools/health/pool" },
] as const

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export function PlatformApiToolsPanel() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [health, setHealth] = useState<unknown>(null)
  const [databaseHealth, setDatabaseHealth] = useState<unknown>(null)
  const [poolHealth, setPoolHealth] = useState<unknown>(null)

  const loadHealth = useCallback(async (showToastOnError = true) => {
    const [healthRes, dbRes, poolRes] = await Promise.all([
      getPlatformHealth(),
      getPlatformDatabaseHealth(),
      getPlatformPoolHealth(),
    ])

    const errors = [healthRes, dbRes, poolRes].filter((r) => r.status !== "success")
    if (errors.length > 0) {
      if (showToastOnError) {
        handleApiErrorResponse(errors[0])
      }
      return false
    }

    if (
      healthRes.status !== "success" ||
      dbRes.status !== "success" ||
      poolRes.status !== "success"
    ) {
      return false
    }

    setHealth(healthRes.data)
    setDatabaseHealth(dbRes.data)
    setPoolHealth(poolRes.data)
    return true
  }, [])

  useEffect(() => {
    loadHealth(false).finally(() => setLoading(false))
  }, [loadHealth])

  const handleRefresh = async () => {
    setRefreshing(true)
    const ok = await loadHealth()
    setRefreshing(false)
    if (ok) toast.success("Health data refreshed")
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API documentation</CardTitle>
          <CardDescription>
            Interactive docs and the OpenAPI schema. Links open in a new tab using your current
            session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {DOC_LINKS.map((link) => (
            <div key={link.href} className="flex items-center justify-between gap-4 rounded-md border p-3">
              <span className="font-medium">{link.label}</span>
              <Button variant="outline" size="sm" asChild>
                <Link href={link.href} target="_blank" rel="noopener noreferrer">
                  Open
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Health endpoints</CardTitle>
            <CardDescription>
              Live status from the API. Raw JSON is available via the links below.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading health data…
            </div>
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-medium">Overall</h3>
                {health ? <JsonBlock data={health} /> : <p className="text-sm text-muted-foreground">Unavailable</p>}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Database</h3>
                {databaseHealth ? (
                  <JsonBlock data={databaseHealth} />
                ) : (
                  <p className="text-sm text-muted-foreground">Unavailable</p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Connection pool</h3>
                {poolHealth ? (
                  <JsonBlock data={poolHealth} />
                ) : (
                  <p className="text-sm text-muted-foreground">Unavailable</p>
                )}
              </div>
            </>
          )}

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">Raw JSON endpoints</p>
            {HEALTH_LINKS.map((link) => (
              <div key={link.href} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <span className="font-medium">{link.label}</span>
                <Button variant="outline" size="sm" asChild>
                  <Link href={link.href} target="_blank" rel="noopener noreferrer">
                    Open
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
