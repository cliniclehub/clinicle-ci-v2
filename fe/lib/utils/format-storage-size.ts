/**
 * Format byte counts for display. Cloudflare R2 / AWS consoles use decimal (SI) units
 * (1 MB = 1,000,000 bytes). Older UI used 1024 divisors but labeled "MB", which
 * looks ~4.9% smaller than the bucket UI for the same object.
 */

export type StorageSizeFormat = "decimal" | "binary"

const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const

function formatWithBase(
  bytes: number,
  base: number,
  units: readonly string[],
  fractionDigits = 2
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes === 0) return "0 B"

  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  )
  const value = bytes / Math.pow(base, i)
  const rounded = i === 0 ? String(Math.round(value)) : value.toFixed(fractionDigits)

  return `${rounded} ${units[i]}`
}

/** Matches Cloudflare R2 / typical object-storage console (1 MB = 10⁶ bytes). */
export function formatStorageSize(
  bytes: number,
  format: StorageSizeFormat = "decimal",
  fractionDigits = 2
): string {
  if (format === "binary") {
    return formatWithBase(bytes, 1024, BINARY_UNITS, fractionDigits)
  }
  return formatWithBase(bytes, 1000, DECIMAL_UNITS, fractionDigits)
}

/**
 * Human-friendly limit labels (e.g. upload caps defined as `5 * 1024 * 1024` → "5 MB").
 * Use for max-size hints; use {@link formatStorageSize} for actual stored object sizes (R2 console).
 */
export function formatStorageLimit(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes === 0) return "0 B"

  const steps: { unit: string; exp: number }[] = [
    { unit: "TB", exp: 4 },
    { unit: "GB", exp: 3 },
    { unit: "MB", exp: 2 },
    { unit: "KB", exp: 1 },
  ]

  for (const { unit, exp } of steps) {
    const divisor = Math.pow(1024, exp)
    if (bytes >= divisor && bytes % divisor === 0) {
      const n = bytes / divisor
      return `${n} ${unit}`
    }
  }

  return formatStorageSize(bytes, "decimal", 0)
}

/** Hover / screen-reader detail: exact byte count. */
export function formatStorageSizeDetail(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ""
  return `${bytes.toLocaleString()} bytes`
}
