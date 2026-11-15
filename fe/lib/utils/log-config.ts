/**
 * Logging knobs shared with the backend model:
 * - LOG_LEVEL
 * - LOG_HTTP_HEADERS
 * - LOG_HTTP_BODIES
 *
 * Local defaults are verbose; non-local (Render) defaults are quiet.
 * Secrets are still redacted whenever headers/bodies are logged.
 */

/**
 * Next.js inlines only static `process.env.NAME` access into the server bundle.
 * `process.env[name]` is undefined on Render, which made these knobs fall back
 * to local defaults (HTTP bodies on).
 */
function readEnv(
  name:
    | "ENVIRONMENT"
    | "NODE_ENV"
    | "NEXT_PUBLIC_ENVIRONMENT"
    | "LOG_LEVEL"
    | "LOG_HTTP_HEADERS"
    | "LOG_HTTP_BODIES"
): string | undefined {
  const value = {
    ENVIRONMENT: process.env.ENVIRONMENT,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_HTTP_HEADERS: process.env.LOG_HTTP_HEADERS,
    LOG_HTTP_BODIES: process.env.LOG_HTTP_BODIES,
  }[name]
  if (value === undefined || value.trim() === "") return undefined
  return value.trim()
}

export function getLoggingEnvironment(): string {
  return (
    readEnv("ENVIRONMENT") ||
    readEnv("NEXT_PUBLIC_ENVIRONMENT") ||
    readEnv("NODE_ENV") ||
    "local"
  ).toLowerCase()
}

export function isLocalLoggingEnvironment(): boolean {
  const env = getLoggingEnvironment()
  return env === "local" || env === "development"
}

function envBool(
  name: "LOG_HTTP_HEADERS" | "LOG_HTTP_BODIES",
  defaultLocal: boolean,
  defaultNonLocal: boolean
): boolean {
  const raw = readEnv(name)
  if (raw === undefined) {
    return isLocalLoggingEnvironment() ? defaultLocal : defaultNonLocal
  }
  return raw.toLowerCase() === "true"
}

/** Minimum severity: DEBUG locally, INFO on Render unless overridden. */
export function getServerLogLevel(): string {
  return (
    readEnv("LOG_LEVEL") ||
    (isLocalLoggingEnvironment() ? "DEBUG" : "INFO")
  ).toUpperCase()
}

/** When true, api-caller may log (redacted) HTTP headers. */
export function getLogHttpHeaders(): boolean {
  return envBool("LOG_HTTP_HEADERS", true, false)
}

/** When true, api-caller may log (redacted) HTTP request/response bodies. */
export function getLogHttpBodies(): boolean {
  return envBool("LOG_HTTP_BODIES", true, false)
}

export function shouldLogHttpExchange(): boolean {
  return getLogHttpHeaders() || getLogHttpBodies()
}
