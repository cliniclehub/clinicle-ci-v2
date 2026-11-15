import { appBuild } from "@/lib/build-info"

export const RELOAD_GUARD_KEY = "platform:deployment-skew-reload"

/** Cooldown between reload attempts (ms). */
export const RELOAD_COOLDOWN_MS = 60_000

/** Max automatic reloads for the same build in one tab session. */
export const MAX_RELOADS_PER_BUILD = 1

type ReloadGuardState = {
  build: string
  at: number
  count: number
}

export function getCurrentBuildId(): string {
  return appBuild || "unknown"
}

function parseReloadGuard(raw: string | null): ReloadGuardState | null {
  if (!raw || raw === "1") {
    return raw === "1" ? { build: getCurrentBuildId(), at: 0, count: 1 } : null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReloadGuardState>
    if (
      typeof parsed.build === "string" &&
      typeof parsed.at === "number" &&
      typeof parsed.count === "number"
    ) {
      return parsed as ReloadGuardState
    }
  } catch {
    // Legacy or corrupted value — treat as already handled.
    return { build: getCurrentBuildId(), at: 0, count: 1 }
  }

  return null
}

export function shouldAllowDeploymentReload(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const build = getCurrentBuildId()
  const guard = parseReloadGuard(sessionStorage.getItem(RELOAD_GUARD_KEY))
  if (!guard) {
    return true
  }

  if (guard.build === build && guard.count >= MAX_RELOADS_PER_BUILD) {
    return false
  }

  if (Date.now() - guard.at < RELOAD_COOLDOWN_MS) {
    return false
  }

  return true
}

export function recordDeploymentReloadAttempt(): void {
  if (typeof window === "undefined") {
    return
  }

  const build = getCurrentBuildId()
  const guard = parseReloadGuard(sessionStorage.getItem(RELOAD_GUARD_KEY))
  const count = guard?.build === build ? guard.count + 1 : 1

  sessionStorage.setItem(
    RELOAD_GUARD_KEY,
    JSON.stringify({ build, at: Date.now(), count } satisfies ReloadGuardState)
  )
}

/** High-confidence Next.js deployment skew (safe to inspect server-action responses). */
export const SERVER_ACTION_DEPLOYMENT_PATTERNS = [
  /failed to find server action/i,
  /server action .* was not found/i,
  /this request might be from an older or newer deployment/i,
] as const

/** Chunk load failures — often network/cache, not a new deploy. Only use with global errors. */
export const CHUNK_DEPLOYMENT_PATTERNS = [
  /loading chunk .* failed/i,
  /chunkloaderror/i,
  /failed to fetch dynamically imported module/i,
] as const

export function messageLooksLikeServerActionDeploymentSkew(message: string): boolean {
  return SERVER_ACTION_DEPLOYMENT_PATTERNS.some((pattern) => pattern.test(message))
}

export function messageLooksLikeChunkLoadFailure(message: string): boolean {
  return CHUNK_DEPLOYMENT_PATTERNS.some((pattern) => pattern.test(message))
}

export function isLikelyServerActionFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): boolean {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  return headers.has("Next-Action") || headers.has("next-action")
}

/** Early inline bootstrap script — runs before React hydrates. */
export function buildDeploymentSkewInlineScript(buildId: string): string {
  const build = JSON.stringify(buildId)
  return `(function(){var k=${JSON.stringify(RELOAD_GUARD_KEY)};var build=${build};var cooldown=${RELOAD_COOLDOWN_MS};var max=${MAX_RELOADS_PER_BUILD};function parse(raw){if(!raw)return null;if(raw==="1")return{build:build,at:0,count:1};try{var g=JSON.parse(raw);if(g&&typeof g.build==="string"&&typeof g.at==="number"&&typeof g.count==="number")return g}catch(e){return{build:build,at:0,count:1}}return null}function allow(){var g=parse(sessionStorage.getItem(k));if(!g)return true;if(g.build===build&&g.count>=max)return false;if(Date.now()-g.at<cooldown)return false;return true}function record(){var g=parse(sessionStorage.getItem(k));var count=g&&g.build===build?g.count+1:1;sessionStorage.setItem(k,JSON.stringify({build:build,at:Date.now(),count:count}))}function r(m){if(!/loading chunk .* failed|chunkloaderror|failed to fetch dynamically imported module/i.test(m||""))return;if(!allow())return;record();window.location.reload()}window.addEventListener("error",function(e){r(e&&e.message)});window.addEventListener("unhandledrejection",function(e){var x=e&&e.reason;r(x&&x.message?x.message:String(x||""))})})();`
}
