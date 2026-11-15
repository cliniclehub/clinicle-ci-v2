/** Organization theme typography helpers (branding + runtime theme apply). */

export type ThemeFontGeneric = "sans-serif" | "serif" | "monospace"

export const THEME_FONT_OPTIONS = [
  { value: "Inter", label: "Inter (sans)", googleFamily: "Inter", generic: "sans-serif" },
  { value: "Source Sans 3", label: "Source Sans 3 (sans)", googleFamily: "Source+Sans+3", generic: "sans-serif" },
  { value: "Nunito", label: "Nunito (rounded sans)", googleFamily: "Nunito", generic: "sans-serif" },
  { value: "Lora", label: "Lora (serif)", googleFamily: "Lora", generic: "serif" },
  { value: "Merriweather", label: "Merriweather (serif)", googleFamily: "Merriweather", generic: "serif" },
  { value: "Playfair Display", label: "Playfair Display (serif)", googleFamily: "Playfair+Display", generic: "serif" },
  { value: "Roboto Slab", label: "Roboto Slab (slab)", googleFamily: "Roboto+Slab", generic: "serif" },
  { value: "IBM Plex Mono", label: "IBM Plex Mono (mono)", googleFamily: "IBM+Plex+Mono", generic: "monospace" },
] as const

export const DEFAULT_THEME_FONT_FAMILY = "Inter"

/** Older branding choices still load if saved on an organization theme. */
const LEGACY_THEME_FONTS: ReadonlyArray<{
  value: string
  googleFamily: string
  generic: ThemeFontGeneric
}> = [
  { value: "Roboto", googleFamily: "Roboto", generic: "sans-serif" },
  { value: "Open Sans", googleFamily: "Open+Sans", generic: "sans-serif" },
  { value: "Lato", googleFamily: "Lato", generic: "sans-serif" },
  { value: "Poppins", googleFamily: "Poppins", generic: "sans-serif" },
  { value: "Montserrat", googleFamily: "Montserrat", generic: "sans-serif" },
]

const FALLBACK_BY_GENERIC: Record<ThemeFontGeneric, string> = {
  "sans-serif":
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  monospace:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
}

const GOOGLE_FONT_LINK_ATTR = "data-platform-theme-font"
const GOOGLE_FONT_PICKER_ATTR = "data-platform-theme-font-picker"
const FONT_PREVIEW_STYLE_ID = "platform-theme-font-preview-styles"

/** Attribute used by the branding font picker to force each option's face. */
export const THEME_FONT_PREVIEW_ATTR = "data-theme-font-preview"

function resolveFontOption(fontFamily: string) {
  const name = fontFamily.trim().toLowerCase()
  return (
    THEME_FONT_OPTIONS.find((option) => option.value.toLowerCase() === name) ??
    LEGACY_THEME_FONTS.find((option) => option.value.toLowerCase() === name)
  )
}

function genericForFamily(fontFamily: string): ThemeFontGeneric {
  return resolveFontOption(fontFamily)?.generic ?? "sans-serif"
}

function ensureFontPreviewStyles(): void {
  if (typeof document === "undefined") return

  let style = document.getElementById(FONT_PREVIEW_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = FONT_PREVIEW_STYLE_ID
    document.head.appendChild(style)
  }

  style.textContent = [...THEME_FONT_OPTIONS, ...LEGACY_THEME_FONTS]
    .map(
      (option) =>
        `[${THEME_FONT_PREVIEW_ATTR}="${option.value}"]{font-family:${quoteFontFamilyName(option.value)},${option.generic}!important}`
    )
    .join("")
}

/** Quote multi-word family names for CSS. */
export function quoteFontFamilyName(fontFamily: string): string {
  const trimmed = fontFamily.trim()
  if (!trimmed) return `'Inter'`
  if (trimmed.includes(" ") && !trimmed.startsWith("'") && !trimmed.startsWith('"')) {
    return `'${trimmed.replace(/'/g, "")}'`
  }
  return trimmed
}

/** Full CSS font-family stack so missing webfonts never fall back to Times/serif. */
export function buildThemeFontStack(fontFamily?: string | null): string {
  const name = (fontFamily || DEFAULT_THEME_FONT_FAMILY).trim() || DEFAULT_THEME_FONT_FAMILY
  const generic = genericForFamily(name)
  return `${quoteFontFamilyName(name)}, ${FALLBACK_BY_GENERIC[generic]}`
}

function ensureGoogleFontsPreconnect(): void {
  if (typeof document === "undefined") return
  if (document.querySelector('link[href*="fonts.googleapis.com"][rel="preconnect"]')) {
    return
  }

  const preconnectApi = document.createElement("link")
  preconnectApi.rel = "preconnect"
  preconnectApi.href = "https://fonts.googleapis.com"
  document.head.appendChild(preconnectApi)

  const preconnectStatic = document.createElement("link")
  preconnectStatic.rel = "preconnect"
  preconnectStatic.href = "https://fonts.gstatic.com"
  preconnectStatic.crossOrigin = "anonymous"
  document.head.appendChild(preconnectStatic)
}

function googleHrefForFamily(fontFamily: string): string | null {
  const match = resolveFontOption(fontFamily)
  if (!match) return null
  return `https://fonts.googleapis.com/css2?family=${match.googleFamily}:wght@400;500;600;700&display=swap`
}

function appendStylesheet(href: string, attr: string): void {
  if (typeof document === "undefined") return
  if (document.querySelector(`link[${attr}][href="${href}"]`)) return

  ensureGoogleFontsPreconnect()
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  link.setAttribute(attr, "true")
  document.head.appendChild(link)
}

/** Ensure the selected Google Font stylesheet is present in <head>. */
export function ensureThemeFontLoaded(fontFamily?: string | null): void {
  if (typeof document === "undefined") return
  const name = (fontFamily || DEFAULT_THEME_FONT_FAMILY).trim() || DEFAULT_THEME_FONT_FAMILY
  const href = googleHrefForFamily(name)
  if (!href) return
  appendStylesheet(href, GOOGLE_FONT_LINK_ATTR)
}

/** Load every branding font option so the picker can preview native faces. */
export function ensureAllThemeFontsLoaded(): void {
  if (typeof document === "undefined") return

  ensureFontPreviewStyles()

  // One stylesheet per family — more reliable than a single multi-family URL.
  for (const option of THEME_FONT_OPTIONS) {
    const href = googleHrefForFamily(option.value)
    if (href) appendStylesheet(href, GOOGLE_FONT_PICKER_ATTR)
  }

  // Force the browser to fetch faces before the picker paints (best-effort).
  if (document.fonts?.load) {
    void Promise.all(
      THEME_FONT_OPTIONS.map((option) =>
        document.fonts
          .load(`400 16px ${quoteFontFamilyName(option.value)}`)
          .catch(() => undefined)
      )
    )
  }
}
