/**
 * Shared log redaction for server-side HTTP / structured logging.
 * Mirrors be/app/common/log_redaction.py (secrets always scrubbed).
 */

const REDACTED = "[REDACTED]"

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|auth|cookie|api[_-]?key|access[_-]?key|refresh[_-]?token|session|credit|card|cvv|cvc|ssn|payment[_-]?method|client[_-]?secret|private[_-]?key|presigned|playback|signed[_-]?url|media[_-]?token|(^|_)(otp|code)$|(email)?verification[_-]?code)/i

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "mediatoken",
  "media_token",
  "access_token",
  "refresh_token",
  "authorization",
  "invitationtoken",
  "invitation_token",
  "code",
  "otp",
  "expires",
  "signature",
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
])

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "session-token",
])

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function looksLikeUrl(value: string): boolean {
  const lowered = value.trim().toLowerCase()
  return (
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.includes("://")
  )
}

export function redactUrlForLog(url: string): string {
  if (!url) return url
  try {
    const parsed = new URL(url)
    let changed = false
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) || isSensitiveKey(key)) {
        parsed.searchParams.set(key, REDACTED)
        changed = true
      }
    }
    return changed ? parsed.toString() : url
  } catch {
    return REDACTED
  }
}

function redactValue(value: unknown, depth: number, maxDepth: number): unknown {
  if (depth >= maxDepth) return REDACTED

  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, maxDepth))
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : redactValue(item, depth + 1, maxDepth)
    }
    return out
  }

  if (typeof value === "string" && looksLikeUrl(value)) {
    return redactUrlForLog(value)
  }

  return value
}

/** Deep-copy payload with sensitive keys and signed URL query params redacted. */
export function redactForLog<T = unknown>(value: T, maxDepth = 8): T {
  return redactValue(value, 0, maxDepth) as T
}

export function redactHeaderValue(headerName: string, headerValue: string): string {
  if (!headerValue) return "empty"
  const name = headerName.toLowerCase()
  if (SENSITIVE_HEADERS.has(name) || isSensitiveKey(headerName)) {
    return REDACTED
  }
  return headerValue
}

export function redactHeadersForLog(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = redactHeaderValue(key, value)
  }
  return out
}
