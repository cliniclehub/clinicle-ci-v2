export const NOTIFICATION_OFFSET_MINUTES_HELPER =
  "Enter minutes before the event (for example 60 for one hour)."

export function defaultOffsetMinutesPlaceholder(_rule?: unknown): string {
  return "60"
}

export function parseValidatedSingleOffsetInput(
  value: string,
  options?: { required?: boolean }
): { offsetsMinutes: number[]; error?: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    if (options?.required) {
      return { offsetsMinutes: [], error: "Offset is required" }
    }
    return { offsetsMinutes: [] }
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { offsetsMinutes: [], error: "Enter a valid number of minutes" }
  }
  return { offsetsMinutes: [parsed] }
}

export function singleOffsetToDisplayText(minutes: number | number[] | null | undefined): string {
  const value = Array.isArray(minutes) ? minutes[0] : minutes
  if (value == null) return ""
  if (value % 1440 === 0) return `${value / 1440} day(s)`
  if (value % 60 === 0) return `${value / 60} hour(s)`
  return `${value} minute(s)`
}
