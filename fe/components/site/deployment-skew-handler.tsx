"use client"

import {
  getCurrentBuildId,
  isLikelyServerActionFetch,
  messageLooksLikeChunkLoadFailure,
  messageLooksLikeServerActionDeploymentSkew,
  recordDeploymentReloadAttempt,
  shouldAllowDeploymentReload,
} from "@/lib/utils/deployment-skew-guard"
import { createClientLogger } from "@/lib/utils/logger-client"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

const logger = createClientLogger("DeploymentSkewHandler")

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return ""
}

function scheduleReloadForStaleDeployment(reason: string, source: "chunk" | "server-action") {
  if (typeof window === "undefined") {
    return
  }

  if (!shouldAllowDeploymentReload()) {
    logger.warn("Ignoring stale-deployment signal after recent reload", {
      reason,
      source,
      build: getCurrentBuildId(),
    })
    return
  }

  recordDeploymentReloadAttempt()
  toast.info(
    source === "chunk"
      ? "The app updated while this tab was open. Refreshing…"
      : "A new version was deployed. Refreshing the page…"
  )

  window.setTimeout(() => {
    window.location.reload()
  }, 400)
}

function inspectRuntimeError(message: string) {
  if (messageLooksLikeServerActionDeploymentSkew(message)) {
    scheduleReloadForStaleDeployment(message, "server-action")
    return
  }

  if (messageLooksLikeChunkLoadFailure(message)) {
    scheduleReloadForStaleDeployment(message, "chunk")
  }
}

/**
 * Recover from version skew when a tab stayed open across a redeploy.
 * Chunk load errors are treated conservatively (once per build) because they
 * are often caused by network blips rather than a new deployment.
 */
export function DeploymentSkewHandler() {
  const patchedFetchRef = useRef(false)

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      inspectRuntimeError(extractErrorMessage(event.reason))
    }

    const onError = (event: ErrorEvent) => {
      inspectRuntimeError(event.message ?? "")
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("error", onError)

    if (!patchedFetchRef.current) {
      patchedFetchRef.current = true
      const originalFetch = window.fetch.bind(window)

      window.fetch = async (...args) => {
        const response = await originalFetch(...args)

        try {
          const init = args[1]
          const request = args[0]
          const method = (
            init?.method ?? (request instanceof Request ? request.method : "GET")
          ).toUpperCase()

          if (
            method === "POST" &&
            isLikelyServerActionFetch(request, init) &&
            !response.ok
          ) {
            const bodyText = await response.clone().text()
            if (messageLooksLikeServerActionDeploymentSkew(bodyText)) {
              scheduleReloadForStaleDeployment(bodyText, "server-action")
            }
          }
        } catch (error) {
          logger.error("Failed to inspect server action response", error as Error)
        }

        return response
      }
    }

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("error", onError)
    }
  }, [])

  return null
}
