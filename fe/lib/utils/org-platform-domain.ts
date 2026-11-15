/** Env-driven platform host helpers. No hardcoded vendor domain is required. */

export type OrgDomainKind = "platform" | "custom"

function readEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === "") return ""
  return value.trim()
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function normalizeDnsHostname(raw: string): string {
  let s = (raw || "").trim().toLowerCase()
  if (s.startsWith("http://")) s = s.slice(7)
  if (s.startsWith("https://")) s = s.slice(8)
  const slash = s.indexOf("/")
  if (slash >= 0) s = s.slice(0, slash)
  const colon = s.indexOf(":")
  if (colon >= 0) s = s.slice(0, colon)
  return s
}

function defaultBaseDomain(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  const normalized = env.toLowerCase().trim()
  if (["production", "prod"].includes(normalized)) {
    return readEnv("NEXT_PUBLIC_PLATFORM_PROD_DOMAIN") || "localhost"
  }
  if (["test", "tst", "testing"].includes(normalized)) {
    return readEnv("NEXT_PUBLIC_PLATFORM_TEST_DOMAIN") || "localhost"
  }
  if (["integration", "int", "staging"].includes(normalized)) {
    return readEnv("NEXT_PUBLIC_PLATFORM_INT_DOMAIN") || "localhost"
  }
  return readEnv("NEXT_PUBLIC_PLATFORM_LOCAL_DOMAIN") || "localhost"
}

export function resolvePlatformBaseDomain(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  return readEnv("NEXT_PUBLIC_PLATFORM_BASE_DOMAIN") || defaultBaseDomain(env)
}

export function resolvePlatformCnameTarget(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  return readEnv("NEXT_PUBLIC_PLATFORM_CNAME_TARGET") || resolvePlatformBaseDomain(env)
}

/** @deprecated Use resolvePlatformCnameTarget. */
export function resolveLmsCnameTarget(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  return resolvePlatformCnameTarget(env)
}

export function platformDomainSuffixes(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string[] {
  const configured = splitCsv(readEnv("NEXT_PUBLIC_PLATFORM_DOMAIN_SUFFIXES"))
  const base = resolvePlatformBaseDomain(env)
  const suffixes = configured.length > 0 ? configured : [base]
  return Array.from(new Set(suffixes.filter(Boolean)))
}

export function isLocalPlatformEnv(
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): boolean {
  const base = resolvePlatformBaseDomain(env)
  return base === "localhost" || base.endsWith(".localhost") || base.endsWith(".local")
}

export function isPlatformHostname(hostname: string | undefined | null): boolean {
  const host = normalizeDnsHostname(hostname || "")
  if (!host) return false
  return platformDomainSuffixes().some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

export function inferOrgDomainKind(domain: string | undefined | null): OrgDomainKind {
  if (isPlatformHostname(domain)) return "platform"
  return "custom"
}

export function buildPlatformDomain(
  hostnameOrDomain: string | undefined | null,
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  const raw = normalizeDnsHostname(hostnameOrDomain || "")
  if (!raw) return ""

  if (platformDomainSuffixes(env).some((suffix) => raw === suffix || raw.endsWith(`.${suffix}`))) {
    return raw
  }

  const base = resolvePlatformBaseDomain(env)
  if (isLocalPlatformEnv(env) && raw.includes(".")) {
    return raw
  }

  return `${raw}.${base}`
}

export function extractPlatformHostname(
  fullDomain: string | undefined | null,
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): string {
  if (!fullDomain) return ""
  const trimmed = normalizeDnsHostname(fullDomain)
  const suffixes = platformDomainSuffixes(env)
    .slice()
    .sort((a, b) => b.length - a.length)

  for (const suffix of suffixes) {
    const dotted = `.${suffix}`
    if (trimmed.endsWith(dotted)) {
      return trimmed.slice(0, -dotted.length).trim()
    }
    if (trimmed === suffix) {
      return ""
    }
  }

  return trimmed
}

export function getCustomDomainSubdomainLabel(domain: string): string {
  if (!domain) return ""
  const parts = domain.split(".")
  if (parts.length >= 3) return parts[0]
  if (parts.length === 2) return "@"
  return parts[0] || "@"
}

export function getCustomDomainParentZone(domain: string): string {
  if (!domain) return ""
  const parts = domain.split(".")
  if (parts.length >= 3) return parts.slice(1).join(".")
  return domain
}

export function isValidPlatformHostnameInput(
  value: string,
  env: string = process.env.NEXT_PUBLIC_ENVIRONMENT || ""
): boolean {
  const raw = normalizeDnsHostname(value)
  if (!raw) return false
  if (isPlatformHostname(raw)) return true
  if (isLocalPlatformEnv(env) && raw.includes(".")) {
    return /^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(raw)
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(raw)
}

export function isValidCustomDomain(value: string): boolean {
  const raw = normalizeDnsHostname(value)
  return /^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(raw)
}
