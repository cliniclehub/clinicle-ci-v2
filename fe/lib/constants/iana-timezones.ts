/**
 * Preset time zones for user profile (GMT labels + IANA id stored in API).
 * Used on settings → Profile; values must pass backend IANA validation.
 */
export const USER_PROFILE_PRESET_TIMEZONES: { value: string; label: string }[] = [
  { value: "UTC", label: "(GMT ±0:00) UTC — Coordinated Universal Time" },
  { value: "Pacific/Kwajalein", label: "(GMT -12:00) Eniwetok, Kwajalein" },
  { value: "Pacific/Midway", label: "(GMT -11:00) Midway Island, Samoa" },
  { value: "Pacific/Honolulu", label: "(GMT -10:00) Hawaii" },
  { value: "Pacific/Marquesas", label: "(GMT -9:30) Taiohae" },
  { value: "America/Anchorage", label: "(GMT -9:00) Alaska" },
  { value: "America/Los_Angeles", label: "(GMT -8:00) Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "(GMT -7:00) Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "(GMT -6:00) Central Time (US & Canada), Mexico City" },
  { value: "America/New_York", label: "(GMT -5:00) Eastern Time (US & Canada), Bogota, Lima" },
  { value: "America/Caracas", label: "(GMT -4:30) Caracas" },
  { value: "America/Halifax", label: "(GMT -4:00) Atlantic Time (Canada), Caracas, La Paz" },
  { value: "America/St_Johns", label: "(GMT -3:30) Newfoundland" },
  { value: "America/Sao_Paulo", label: "(GMT -3:00) Brazil, Buenos Aires, Georgetown" },
  { value: "Atlantic/South_Georgia", label: "(GMT -2:00) Mid-Atlantic" },
  { value: "Atlantic/Azores", label: "(GMT -1:00) Azores, Cape Verde Islands" },
  { value: "Europe/London", label: "(GMT +0:00) Western Europe Time, London, Lisbon, Casablanca" },
  { value: "Europe/Brussels", label: "(GMT +1:00) Brussels, Copenhagen, Madrid, Paris" },
  { value: "Europe/Kaliningrad", label: "(GMT +2:00) Kaliningrad, South Africa" },
  { value: "Europe/Moscow", label: "(GMT +3:00) Baghdad, Riyadh, Moscow, St. Petersburg" },
  { value: "Asia/Tehran", label: "(GMT +3:30) Tehran" },
  { value: "Asia/Dubai", label: "(GMT +4:00) Abu Dhabi, Muscat, Baku, Tbilisi" },
  { value: "Asia/Kabul", label: "(GMT +4:30) Kabul" },
  { value: "Asia/Karachi", label: "(GMT +5:00) Ekaterinburg, Islamabad, Karachi, Tashkent" },
  { value: "Asia/Kolkata", label: "(GMT +5:30) Bombay, Calcutta, Madras, New Delhi" },
  { value: "Asia/Kathmandu", label: "(GMT +5:45) Kathmandu, Pokhara" },
  { value: "Asia/Dhaka", label: "(GMT +6:00) Almaty, Dhaka, Colombo" },
  { value: "Asia/Yangon", label: "(GMT +6:30) Yangon, Mandalay" },
  { value: "Asia/Bangkok", label: "(GMT +7:00) Bangkok, Hanoi, Jakarta" },
  { value: "Asia/Shanghai", label: "(GMT +8:00) Beijing, Perth, Singapore, Hong Kong" },
  { value: "Australia/Eucla", label: "(GMT +8:45) Eucla" },
  { value: "Asia/Tokyo", label: "(GMT +9:00) Tokyo, Seoul, Osaka, Sapporo, Yakutsk" },
  { value: "Australia/Adelaide", label: "(GMT +9:30) Adelaide, Darwin" },
  { value: "Australia/Sydney", label: "(GMT +10:00) Eastern Australia, Guam, Vladivostok" },
  { value: "Australia/Lord_Howe", label: "(GMT +10:30) Lord Howe Island" },
  { value: "Asia/Magadan", label: "(GMT +11:00) Magadan, Solomon Islands, New Caledonia" },
  { value: "Pacific/Norfolk", label: "(GMT +11:30) Norfolk Island" },
  { value: "Pacific/Auckland", label: "(GMT +12:00) Auckland, Wellington, Fiji, Kamchatka" },
  { value: "Pacific/Chatham", label: "(GMT +12:45) Chatham Islands" },
  { value: "Pacific/Apia", label: "(GMT +13:00) Apia, Nukualofa" },
  { value: "Pacific/Kiritimati", label: "(GMT +14:00) Line Islands, Tokelau" },
]

/**
 * Zones that org settings historically offered but are not in {@link USER_PROFILE_PRESET_TIMEZONES}.
 * Same GMT-style labels as the profile list for consistency.
 */
const ORG_TIMEZONE_EXTRAS: { value: string; label: string }[] = [
  { value: "Europe/Paris", label: "(GMT +1:00) Paris — Central European" },
  { value: "Europe/Berlin", label: "(GMT +1:00) Berlin — Central European" },
  { value: "Europe/Istanbul", label: "(GMT +3:00) Istanbul — Turkey" },
  { value: "Asia/Singapore", label: "(GMT +8:00) Singapore" },
  { value: "Asia/Seoul", label: "(GMT +9:00) Seoul — Korea" },
]

function mergeTimezoneOptionsByValue(
  primary: { value: string; label: string }[],
  extras: { value: string; label: string }[]
): { value: string; label: string }[] {
  const seen = new Set<string>()
  const out: { value: string; label: string }[] = []
  for (const z of primary) {
    if (seen.has(z.value)) continue
    seen.add(z.value)
    out.push(z)
  }
  for (const z of extras) {
    if (seen.has(z.value)) continue
    seen.add(z.value)
    out.push(z)
  }
  return out
}

/**
 * Organization timezone dropdown: same presets as user profile, plus a few
 * historically org-specific IANA ids (Paris, Berlin, Istanbul, Singapore, Seoul).
 */
export const ORG_IANA_TIMEZONES: { value: string; label: string }[] =
  mergeTimezoneOptionsByValue(USER_PROFILE_PRESET_TIMEZONES, ORG_TIMEZONE_EXTRAS)

/** Short label for UI headers and scheduled events. */
export function getOrgTimeZoneShortLabel(iana: string): string {
  const key = iana?.trim() || "UTC"
  const found = ORG_IANA_TIMEZONES.find((z) => z.value === key)
  if (!found) {
    const tail = key.split("/").pop()
    return tail ? tail.replace(/_/g, " ") : key
  }
  const { label } = found
  const m = label.match(/^\([^)]+\)\s*(.+)$/)
  const body = m ? m[1].trim() : label
  const head = body.split(" — ")[0].split(", ")[0].trim()
  return head || key
}
