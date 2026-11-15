"use server"

import { ApiResponse } from "@/lib/types/api-response-schema"
import { getAccessToken, userHasRole } from "@/lib/utils/auth-server-helper"

export type PlatformHealth = {
  status: string
  timestamp: string
  version: string
  release: string
  build: string
  git_sha: string
  environment: string
}

function backendApiV1Base(): string {
  const defaultBaseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:8000"
  return defaultBaseUrl.endsWith("/api/v1")
    ? defaultBaseUrl
    : `${defaultBaseUrl.replace(/\/$/, "")}/api/v1`
}

async function fetchSuperAdminJson<T>(path: string): Promise<ApiResponse<T>> {
  if (!(await userHasRole("super_admin"))) {
    return {
      status: "error",
      code: 403,
      type: "AuthorizationError",
      message: "Insufficient permissions",
      description: "Required role: super_admin",
      timestamp: new Date().toISOString(),
    }
  }

  const token = await getAccessToken()
  if (!token) {
    return {
      status: "error",
      code: 401,
      type: "AuthenticationError",
      message: "Authentication required",
      description: "No authentication token found",
      timestamp: new Date().toISOString(),
    }
  }

  const response = await fetch(`${backendApiV1Base()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (!response.ok) {
    let message = "Request failed"
    try {
      const body = await response.json()
      message = body.message || body.detail || message
    } catch {
      // ignore parse errors
    }
    return {
      status: "error",
      code: response.status,
      type: "RequestError",
      message,
      description: message,
      timestamp: new Date().toISOString(),
    }
  }

  const data = (await response.json()) as T
  return {
    status: "success",
    data,
    message: "Success",
    timestamp: new Date().toISOString(),
    pagination: null,
  }
}

export async function getPlatformHealth(): Promise<ApiResponse<PlatformHealth>> {
  return fetchSuperAdminJson<PlatformHealth>("/health")
}

export async function getPlatformDatabaseHealth(): Promise<ApiResponse<Record<string, unknown>>> {
  return fetchSuperAdminJson<Record<string, unknown>>("/health/database")
}

export async function getPlatformPoolHealth(): Promise<ApiResponse<Record<string, unknown>>> {
  return fetchSuperAdminJson<Record<string, unknown>>("/health/pool")
}
