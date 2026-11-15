/**
 * Utility functions for color conversion and management
 */

/**
 * Converts hex color to HSL format for Tailwind CSS
 */
export function hexToHsl(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '')
  
  // Parse hex values
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
  
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/**
 * Converts HSL color to hex format
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
 * Gets appropriate foreground color for a background color
 */
export function getForegroundColor(backgroundColor: string): string {
  // Convert hex to RGB for brightness calculation
  const hex = backgroundColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  
  // Calculate brightness
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  
  // Return light or dark foreground based on background brightness
  return brightness > 128 ? '222.2 47.4% 11.2%' : '0 0% 98%'
}

/**
 * Applies theme colors to CSS custom properties
 */
export function applyThemeColors(root: HTMLElement, colors: {
  primary: string
  secondary: string
  accent: string
}) {
  // Apply Tailwind variables
  root.style.setProperty('--primary', hexToHsl(colors.primary))
  root.style.setProperty('--primary-foreground', getForegroundColor(colors.primary))
  root.style.setProperty('--secondary', hexToHsl(colors.secondary))
  root.style.setProperty('--secondary-foreground', getForegroundColor(colors.secondary))
  root.style.setProperty('--accent', hexToHsl(colors.accent))
  root.style.setProperty('--accent-foreground', getForegroundColor(colors.accent))
  
  // Also set legacy variables for backward compatibility
  root.style.setProperty('--primary-color', colors.primary)
  root.style.setProperty('--secondary-color', colors.secondary)
  root.style.setProperty('--accent-color', colors.accent)
}

/**
 * Clears all theme color variables
 */
export function clearThemeColors(root: HTMLElement) {
  // Clear Tailwind variables
  root.style.removeProperty('--primary')
  root.style.removeProperty('--primary-foreground')
  root.style.removeProperty('--secondary')
  root.style.removeProperty('--secondary-foreground')
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-foreground')
  
  // Clear legacy variables
  root.style.removeProperty('--primary-color')
  root.style.removeProperty('--secondary-color')
  root.style.removeProperty('--accent-color')
} 