/** Baked at Docker build via NEXT_PUBLIC_*; empty in local dev until set in env-dev.env etc. */

export const appRelease = process.env.NEXT_PUBLIC_APP_RELEASE?.trim() || ''
export const appBuild = process.env.NEXT_PUBLIC_APP_BUILD?.trim() || ''
export const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || ''

export function formatAppVersionLabel(): string | null {
  if (!appRelease && !appBuild) return null
  if (appRelease && appBuild) return `v${appRelease} · ${appBuild}`
  if (appRelease) return `v${appRelease}`
  return appBuild
}
