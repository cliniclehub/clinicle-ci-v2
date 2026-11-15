/** ISO 3166-1 alpha-2 → regional indicator flag emoji (e.g. "US" → 🇺🇸). */
export function countryCodeToFlag(iso: string): string {
  if (!iso || iso.length !== 2) return "🌐"
  const code = iso.toUpperCase()
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65)
  )
}
