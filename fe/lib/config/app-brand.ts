const configuredName = process.env.NEXT_PUBLIC_APP_NAME?.trim()

/** Default platform brand. A tenant organization name overrides it at request time. */
export const DEFAULT_APP_NAME = configuredName || "Clinicle Intelligence App"

export const DEFAULT_APP_DESCRIPTION = `${DEFAULT_APP_NAME} — multi-tenant clinical operations platform`
