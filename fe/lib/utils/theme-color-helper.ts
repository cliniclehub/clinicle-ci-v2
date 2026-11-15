/**
 * Utility functions for generating harmonious theme colors
 */

export interface ThemeColors {
  primary: string
  secondary: string
  accent: string
}

/**
 * Generates a harmonious accent color based on the primary color
 * This ensures the hover states look good together
 */
export function generateHarmoniousAccent(primaryColor: string): string {
  // Convert hex to HSL for better color manipulation
  const hex = primaryColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16) / 255
  const g = parseInt(hex.substr(2, 2), 16) / 255
  const b = parseInt(hex.substr(4, 2), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  // Generate a complementary or analogous accent color
  // For dark primary colors, use a lighter accent
  // For light primary colors, use a darker accent
  if (l < 0.3) {
    // Dark primary - use a lighter accent
    return `hsl(${h * 360}, ${Math.min(s * 100 + 20, 100)}%, ${Math.min(l * 100 + 40, 80)}%)`
  } else if (l > 0.7) {
    // Light primary - use a darker accent
    return `hsl(${h * 360}, ${Math.min(s * 100 + 20, 100)}%, ${Math.max(l * 100 - 40, 20)}%)`
  } else {
    // Medium primary - use a complementary color
    const complementaryHue = (h * 360 + 180) % 360
    return `hsl(${complementaryHue}, ${Math.min(s * 100 + 20, 100)}%, ${Math.min(l * 100 + 20, 70)}%)`
  }
}

/**
 * Converts HSL color to hex
 */
export function hslToHex(h: number, s: number, l: number): string {
  l /= 100
  const a = s * Math.min(l, 1 - l) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Suggests better theme colors based on the current primary color
 */
export function suggestThemeColors(primaryColor: string): ThemeColors {
  const accent = generateHarmoniousAccent(primaryColor)
  
  // Generate a neutral secondary color
  const hex = primaryColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  
  // Secondary should be a neutral gray
  const secondary = brightness > 128 ? '#666666' : '#999999'
  
  return {
    primary: primaryColor,
    secondary,
    accent
  }
}

/**
 * Predefined harmonious color schemes
 */
export const HARMONIOUS_THEMES = {
  professional: {
    primary: '#1f2937', // Dark gray
    secondary: '#6b7280', // Medium gray
    accent: '#3b82f6', // Blue
  },
  modern: {
    primary: '#000000', // Black
    secondary: '#6b7280', // Gray
    accent: '#6366f1', // Indigo
  },
  warm: {
    primary: '#7c2d12', // Brown
    secondary: '#9ca3af', // Light gray
    accent: '#f59e0b', // Amber
  },
  cool: {
    primary: '#1e40af', // Blue
    secondary: '#6b7280', // Gray
    accent: '#10b981', // Emerald
  },
  minimal: {
    primary: '#374151', // Dark gray
    secondary: '#9ca3af', // Light gray
    accent: '#6b7280', // Medium gray
  }
} 