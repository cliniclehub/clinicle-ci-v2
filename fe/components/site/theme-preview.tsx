"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTheme } from "@/lib/contexts/theme-context"

export function ThemePreview() {
  const { theme } = useTheme()

  if (!theme) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Theme Status</CardTitle>
          <CardDescription>No custom theme applied</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Using default theme colors
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Current Theme</CardTitle>
        <CardDescription>Organization theme applied</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="font-medium mb-2">Colors</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div 
                className="w-6 h-6 rounded border"
                style={{ backgroundColor: theme.colors.primary }}
              />
              <span className="text-sm">Primary: {theme.colors.primary}</span>
            </div>
            <div className="flex items-center gap-2">
              <div 
                className="w-6 h-6 rounded border"
                style={{ backgroundColor: theme.colors.secondary }}
              />
              <span className="text-sm">Secondary: {theme.colors.secondary}</span>
            </div>
            <div className="flex items-center gap-2">
              <div 
                className="w-6 h-6 rounded border"
                style={{ backgroundColor: theme.colors.accent }}
              />
              <span className="text-sm">Accent: {theme.colors.accent}</span>
            </div>
          </div>
        </div>
        
        <div>
          <h4 className="font-medium mb-2">Typography</h4>
          <p className="text-sm" style={{ fontFamily: theme.typography.fontFamily }}>
            Font: {theme.typography.fontFamily}
          </p>
        </div>

        <div>
          <h4 className="font-medium mb-2">Preview</h4>
          <div className="space-y-2">
            <button 
              className="px-4 py-2 rounded text-white text-sm"
              style={{ backgroundColor: theme.colors.primary }}
            >
              Primary Button
            </button>
            <button 
              className="px-4 py-2 rounded text-white text-sm"
              style={{ backgroundColor: theme.colors.accent }}
            >
              Accent Button
            </button>
            <p 
              className="text-sm"
              style={{ color: theme.colors.secondary }}
            >
              Secondary text color
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
} 