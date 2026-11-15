/**
 * Trim and title-case a person name for consistent storage/display.
 * Handles spaces, hyphens, and apostrophes (e.g. mary-jane o'brien → Mary-Jane O'Brien).
 */
export function normalizePersonName(value: string | null | undefined): string {
  if (value == null) return ""
  const text = value.trim().replace(/\s+/g, " ")
  if (!text) return ""
  return text
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => normalizeNameParticle(part))
        .join("-")
    )
    .join(" ")
}

/** Soft UI copy when a name looks like an initial / placeholder rather than a full name. */
export const SHORT_PERSON_NAME_WARNING =
  "This looks shorter than a typical name. Please make sure you're entering your real full first and last name."

export const PERSON_NAME_TOO_SHORT_MESSAGE =
  "Name must contain at least two letters (single initials are not allowed)"

function countPersonNameLetters(value: string | null | undefined): number {
  if (value == null) return 0
  const text = value.trim()
  if (!text) return 0
  return (text.match(/\p{L}/gu) ?? []).length
}

/**
 * True when the value looks incomplete (dot-only, punctuation, or ≤2 letters).
 * Used for soft warnings only — does not block submit by itself.
 */
export function looksLikeIncompletePersonName(
  value: string | null | undefined
): boolean {
  if (value == null) return false
  const text = value.trim()
  if (!text) return false
  return countPersonNameLetters(text) <= 2
}

/** Hard client/API rule: fewer than two letters (e.g. "A", ".") is rejected. */
export function hasInsufficientPersonNameLetters(
  value: string | null | undefined
): boolean {
  if (value == null) return false
  const text = value.trim()
  if (!text) return false
  return countPersonNameLetters(text) < 2
}

function normalizeNameParticle(part: string): string {
  if (!part) return part
  if (part.includes("'")) {
    return part
      .split("'")
      .map((bit) =>
        bit ? bit.charAt(0).toUpperCase() + bit.slice(1).toLowerCase() : bit
      )
      .join("'")
  }
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
}
