"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import {
    Form,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertCircle, Eye, Loader2, Upload } from "lucide-react"

import MediaManager from "@/components/media-manager/media-manager-form"
import { clearOrganizationCache, updateMyOrganizationBranding } from "@/lib/actions/organizations/organizations-org-actions"
import { updateOrganizationBranding as updateOrganizationBrandingPlatform } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization, OrganizationBranding, organizationBrandingSchema } from "@/lib/types/organization-schema"
import {
  DEFAULT_THEME_FONT_FAMILY,
  ensureAllThemeFontsLoaded,
  ensureThemeFontLoaded,
  THEME_FONT_OPTIONS,
} from "@/lib/utils/theme-fonts"

interface BrandingSectionProps {
  organization?: Organization
  isOrgAdmin?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (organization: Organization) => void
}

const THEME_PRESETS = [
  {
    name: "Professional Dark",
    colors: { primary: "#1f2937", secondary: "#6b7280", accent: "#3b82f6" }
  },
  {
    name: "Modern Black", 
    colors: { primary: "#000000", secondary: "#6b7280", accent: "#6366f1" }
  },
  {
    name: "Ocean Blue",
    colors: { primary: "#1e40af", secondary: "#64748b", accent: "#3b82f6" }
  },
  {
    name: "Forest Green",
    colors: { primary: "#166534", secondary: "#6b7280", accent: "#22c55e" }
  },
  {
    name: "Warm Brown",
    colors: { primary: "#7c2d12", secondary: "#9ca3af", accent: "#f59e0b" }
  },
  {
    name: "Cool Blue",
    colors: { primary: "#1e40af", secondary: "#6b7280", accent: "#10b981" }
  },
  {
    name: "Minimal Gray",
    colors: { primary: "#374151", secondary: "#9ca3af", accent: "#6b7280" }
  },
  {
    name: "Sunset Orange",
    colors: { primary: "#ea580c", secondary: "#6b7280", accent: "#f97316" }
  },
  {
    name: "Royal Purple",
    colors: { primary: "#7c3aed", secondary: "#6b7280", accent: "#a855f7" }
  },
  {
    name: "Crimson Red",
    colors: { primary: "#dc2626", secondary: "#6b7280", accent: "#ef4444" }
  }
]

export function BrandingSection({
  organization,
  isOrgAdmin = false,
  onDirtyChange,
  onCancel,
  onSuccess,
}: BrandingSectionProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [mediaManagerOpen, setMediaManagerOpen] = useState(false)
  const [mediaManagerType, setMediaManagerType] = useState<'logo' | 'favicon'>('logo')
  const [theme, setTheme] = useState({
    colors: {
      primary: organization?.siteTheme?.colors?.primary || "#000000",
      secondary: organization?.siteTheme?.colors?.secondary || "#666666",
      accent: organization?.siteTheme?.colors?.accent || "#0070f3",
    },
    typography: {
      fontFamily: organization?.siteTheme?.typography?.fontFamily || DEFAULT_THEME_FONT_FAMILY,
    }
  })

  // Show message if accessed during creation mode
  if (!organization) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">Branding Settings</h3>
            <p className="text-muted-foreground">
              Branding settings will be available after creating the organization.
            </p>
          </div>
        </CardContent>  
      </Card>
    )
  }

  const form = useForm<OrganizationBranding>({
    resolver: zodResolver(organizationBrandingSchema),
    defaultValues: {
      logoUrl: organization?.logoUrl || "",
      faviconUrl: organization?.faviconUrl || "",
      primaryColor: organization?.primaryColor || "",
      secondaryColor: organization?.secondaryColor || "",
      landingPageHtml: organization?.landingPageHtml || "",
      siteTheme: organization?.siteTheme || {
        colors: {
          primary: "#000000",
          secondary: "#666666",
          accent: "#0070f3",
        },
        typography: {
          fontFamily: DEFAULT_THEME_FONT_FAMILY,
        },
      },
    },
  })

  const { formState: { isDirty } } = form

  // Update parent component when dirty state changes
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Prefetch every font option so the dropdown can render each face natively.
  useEffect(() => {
    ensureAllThemeFontsLoaded()
  }, [])

  // Update form when organization data changes
  useEffect(() => {
    if (organization) {
      form.reset({
        logoUrl: organization.logoUrl || "",
        faviconUrl: organization.faviconUrl || "",
        primaryColor: organization.primaryColor || "",
        secondaryColor: organization.secondaryColor || "",
        landingPageHtml: organization.landingPageHtml || "",
        siteTheme: organization.siteTheme || {
          colors: {
            primary: "#000000",
            secondary: "#666666",
            accent: "#0070f3",
          },
          typography: {
            fontFamily: DEFAULT_THEME_FONT_FAMILY,
          }
        }
      }, { keepDirty: false }) // Explicitly clear dirty state when resetting
      setTheme({
        colors: {
          primary: organization.siteTheme?.colors?.primary || "#000000",
          secondary: organization.siteTheme?.colors?.secondary || "#666666",
          accent: organization.siteTheme?.colors?.accent || "#0070f3",
        },
        typography: {
          fontFamily: organization.siteTheme?.typography?.fontFamily || DEFAULT_THEME_FONT_FAMILY,
        }
      })
    }
  }, [organization, form])

  const handleColorChange = (colorType: 'primary' | 'secondary' | 'accent', value: string) => {
    setTheme(prev => ({
      ...prev,
      colors: {
        ...prev.colors,
        [colorType]: value
      }
    }))
    form.setValue('siteTheme', {
      ...theme,
      colors: {
        ...theme.colors,
        [colorType]: value
      }
    }, { shouldDirty: true })
  }

  const handleFontChange = (fontFamily: string) => {
    ensureThemeFontLoaded(fontFamily)
    setTheme(prev => ({
      ...prev,
      typography: {
        ...prev.typography,
        fontFamily
      }
    }))
    form.setValue('siteTheme', {
      ...theme,
      typography: {
        ...theme.typography,
        fontFamily
      }
    }, { shouldDirty: true })
  }

  const handlePresetSelect = (preset: typeof THEME_PRESETS[0]) => {
    // Presets only swap colors; the current Font Family selection is kept.
    setTheme(prev => ({
      ...prev,
      colors: preset.colors
    }))
    form.setValue('siteTheme', {
      ...theme,
      colors: preset.colors
    }, { shouldDirty: true })
  }

  const clearOrgCacheAndReload = async () => {
    if (!organization?.domain) return;
    try {
      await clearOrganizationCache(organization.domain)
      
      toast.success('Cache cleared. Reloading...');
      window.location.reload();
    } catch (err) {
      toast.error('Failed to clear cache. Please reload manually.');
    }
  };

  const onSubmit = async (data: OrganizationBranding) => {
    if (!organization) return

    setIsSaving(true)
    
    try {
      const response = isOrgAdmin
        ? await updateMyOrganizationBranding(data)
        : await updateOrganizationBrandingPlatform(organization.id, data)
      
      if (response.status === "success") {
        toast.success("Branding saved successfully")
        form.reset(data) // Reset with new values to clear dirty state
        // Use the updated organization data from the API response
        onSuccess?.(response.data || organization) // Call onSuccess if provided
        await clearOrgCacheAndReload(); // <-- clear cache and reload
      } else {
        toast.error(response.message || "Failed to save branding")
      }
    } catch (error) {
      toast.error("An error occurred while saving")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    if (isDirty) {
      setShowDirtyDialog(true)
    } else {
      onCancel()
    }
  }

  const handleConfirmCancel = () => {
    form.reset()
    setShowDirtyDialog(false)
    onCancel()
  }

  const handleDismissCancel = () => {
    setShowDirtyDialog(false)
  }

  const handleLogoUpload = () => {
    setMediaManagerType('logo')
    setMediaManagerOpen(true)
  }

  const handleFaviconUpload = () => {
    setMediaManagerType('favicon')
    setMediaManagerOpen(true)
  }

  const handleMediaFileSelected = (fileUrl: string, fileData: any) => {
    if (mediaManagerType === 'logo') {
      form.setValue('logoUrl', fileUrl, { shouldDirty: true })
    } else if (mediaManagerType === 'favicon') {
      form.setValue('faviconUrl', fileUrl, { shouldDirty: true })
    }
    setMediaManagerOpen(false)
  }

  return (
    <div className="space-y-6">


      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Main Branding Card */}
          <Card>
          <CardHeader>
          <CardTitle>Branding & Theme</CardTitle>
          <CardDescription>
            Customize your organization's visual identity and theme settings.
          </CardDescription>
        </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {/* Logos Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      Logos & Assets
                    </CardTitle>
                    <CardDescription>
                      Upload your organization's logo and favicon
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="logoUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Logo</FormLabel>
                            <div className="space-y-3">
                                                          {/* Logo Display and Upload */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                {field.value ? (
                                  <div className="flex items-center justify-center p-3 border rounded-md bg-muted/20">
                                    <img
                                      src={field.value}
                                      alt="Organization logo"
                                      className="h-12 w-auto max-w-[200px] object-contain"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center p-3 border rounded-md bg-muted/20 h-12">
                                    <p className="text-sm text-muted-foreground">No logo uploaded</p>
                                  </div>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleLogoUpload}
                                className="flex items-center gap-2 whitespace-nowrap"
                              >
                                <Upload className="h-4 w-4" />
                                {field.value ? "Change" : "Upload"}
                              </Button>
                            </div>
                            </div>
                            <FormDescription>
                              Organization logo (recommended: 200x50px)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                          name="faviconUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Favicon</FormLabel>
                            <div className="space-y-3">
                                                          {/* Favicon Display and Upload */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                {field.value ? (
                                  <div className="flex items-center justify-center p-3 border rounded-md bg-muted/20">
                                    <img
                                      src={field.value}
                                      alt="Organization favicon"
                                      className="h-8 w-8 object-contain"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = 'none';
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center p-3 border rounded-md bg-muted/20 h-8">
                                    <p className="text-xs text-muted-foreground">No favicon</p>
                                  </div>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleFaviconUpload}
                                className="flex items-center gap-2 whitespace-nowrap"
                              >
                                <Upload className="h-4 w-4" />
                                {field.value ? "Change" : "Upload"}
                              </Button>
                            </div>
                            </div>
                            <FormDescription>
                              Organization favicon (recommended: 32x32px)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Brand Colors and Font Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Brand Colors and Font</CardTitle>
                    <CardDescription>
                      Set your organization's primary, secondary, accent colors and font family.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-6 md:grid-cols-2">
                      {/* Left: Primary & Secondary Colors */}
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="theme-primary-color">Primary Color</Label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={theme.colors.primary}
                                onChange={(e) => handleColorChange('primary', e.target.value)}
                                className="w-8 h-8 rounded border cursor-pointer"
                              />
                              <Input
                                id="theme-primary-color"
                                value={theme.colors.primary}
                                onChange={(e) => handleColorChange('primary', e.target.value)}
                                placeholder="#000000"
                                className="flex-1"
                              />
                              <div 
                                className="w-4 h-4 rounded border"
                                style={{ backgroundColor: theme.colors.primary }}
                              />
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Used for buttons, links, and primary actions
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="theme-secondary-color">Secondary Color</Label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={theme.colors.secondary}
                                onChange={(e) => handleColorChange('secondary', e.target.value)}
                                className="w-8 h-8 rounded border cursor-pointer"
                              />
                              <Input
                                id="theme-secondary-color"
                                value={theme.colors.secondary}
                                onChange={(e) => handleColorChange('secondary', e.target.value)}
                                placeholder="#666666"
                                className="flex-1"
                              />
                              <div 
                                className="w-4 h-4 rounded border"
                                style={{ backgroundColor: theme.colors.secondary }}
                              />
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Used for secondary text and elements
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Right: Accent Color & Typography */}
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <Label htmlFor="theme-accent-color">Accent Color</Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={theme.colors.accent}
                              onChange={(e) => handleColorChange('accent', e.target.value)}
                              className="w-8 h-8 rounded border cursor-pointer"
                            />
                            <Input
                              id="theme-accent-color"
                              value={theme.colors.accent}
                              onChange={(e) => handleColorChange('accent', e.target.value)}
                              placeholder="#0070f3"
                              className="flex-1"
                            />
                            <div 
                              className="w-4 h-4 rounded border"
                              style={{ backgroundColor: theme.colors.accent }}
                            />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Used for highlights and special elements
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            💡 Tip: Outline and ghost buttons use this color on hover. Choose colors that work well together!
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="font-family">Font Family</Label>
                          <Select
                            value={theme.typography.fontFamily}
                            onValueChange={handleFontChange}
                            onOpenChange={(open) => {
                              if (open) ensureAllThemeFontsLoaded()
                            }}
                          >
                            <SelectTrigger
                              id="font-family"
                              data-theme-font-preview={theme.typography.fontFamily}
                            >
                              <SelectValue placeholder="Select a font">
                                {theme.typography.fontFamily}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
                              {THEME_FONT_OPTIONS.map((font) => (
                                <SelectItem
                                  key={font.value}
                                  value={font.value}
                                  className="py-2.5 text-base"
                                  data-theme-font-preview={font.value}
                                >
                                  {font.label}
                                </SelectItem>
                              ))}
                              {!THEME_FONT_OPTIONS.some(
                                (font) => font.value === theme.typography.fontFamily
                              ) &&
                                theme.typography.fontFamily && (
                                  <SelectItem
                                    value={theme.typography.fontFamily}
                                    className="py-2.5 text-base"
                                    data-theme-font-preview={theme.typography.fontFamily}
                                  >
                                    {theme.typography.fontFamily} (saved)
                                  </SelectItem>
                                )}
                            </SelectContent>
                          </Select>
                          <div
                            className="rounded-md border bg-muted/40 px-3 py-3 text-sm leading-relaxed"
                            data-theme-font-preview={theme.typography.fontFamily}
                          >
                            <p className="text-base font-semibold">
                              The quick brown fox jumps over the lazy dog
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Mix of sans, serif, slab, and mono faces. Default is Inter. Theme presets
                            only change colors — pick the font here separately.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Theme Presets in a separate card below */}
                <Card className="mt-8">
                  <CardHeader>
                    <CardTitle>Theme Presets</CardTitle>
                    <CardDescription>
                      Quick color palettes. Your selected font family is unchanged.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {THEME_PRESETS.map((preset) => (
                        <Button
                          key={preset.name}
                          type="button"
                          variant="outline"
                          className="w-full h-auto p-4 flex items-center gap-3 text-left bg-card text-foreground border-border hover:bg-muted"
                          onClick={() => handlePresetSelect(preset)}
                        >
                          <div className="flex gap-2">
                            <div 
                              className="w-6 h-6 rounded-full border"
                              style={{ backgroundColor: preset.colors.primary }}
                            />
                            <div 
                              className="w-6 h-6 rounded-full border"
                              style={{ backgroundColor: preset.colors.secondary }}
                            />
                            <div 
                              className="w-6 h-6 rounded-full border"
                              style={{ backgroundColor: preset.colors.accent }}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">{preset.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {preset.colors.primary}, {preset.colors.secondary}, {preset.colors.accent}
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Footer with Save, Cancel, and Preview Theme all in one row */}
              <div className="flex items-center justify-end gap-4 border-t bg-background px-6 py-4 sticky bottom-0 z-10">
                {isDirty && (
                  <div className="flex items-center gap-2 border border-red-500 bg-red-50 text-red-700 rounded-md px-4 py-2 mr-auto">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                    <span>You have unsaved changes</span>
                  </div>
                )}
                
                <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Preview Theme
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Theme Preview</DialogTitle>
                      <DialogDescription>
                        See how your theme, logo, and favicon will look across the platform
                      </DialogDescription>
                    </DialogHeader>
                    <div 
                      className="p-6 rounded-lg border bg-background"
                      style={{ 
                        fontFamily: theme.typography.fontFamily,
                        '--primary-color': theme.colors.primary,
                        '--secondary-color': theme.colors.secondary,
                        '--accent-color': theme.colors.accent,
                      } as React.CSSProperties}
                    >
                      {/* Header with Logo and Favicon */}
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          {form.getValues('logoUrl') && (
                            <img
                              src={form.getValues('logoUrl')}
                              alt="Organization logo"
                              className="h-10 w-auto max-w-[120px] object-contain"
                            />
                          )}
                          <span className="text-lg font-semibold" style={{ fontFamily: theme.typography.fontFamily }}>
                            {organization?.name || 'Product Platform'}
                          </span>
                        </div>
                          {form.getValues('faviconUrl') && (
                          <img
                            src={form.getValues('faviconUrl')}
                            alt="Favicon"
                            className="h-8 w-8 object-contain rounded"
                            style={{ boxShadow: '0 0 2px #ccc' }}
                          />
                        )}
                      </div>

                      {/* Button Demo Row */}
                      <div className="mb-8">
                        <div className="font-medium mb-2">Button Styles (Hover to preview)</div>
                        <div className="flex flex-wrap gap-3">
                          <Button className="bg-primary text-primary-foreground hover:bg-[color:var(--accent-color)] transition-colors">
                            Primary Button
                          </Button>
                          <Button variant="outline" className="border-primary text-primary hover:bg-[color:var(--accent-color)] hover:text-white transition-colors">
                            Outline Button
                          </Button>
                          <Button variant="ghost" className="hover:bg-[color:var(--accent-color)] hover:text-white transition-colors">
                            Ghost Button
                          </Button>
                          <Button variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-[color:var(--accent-color)] hover:text-white transition-colors">
                            Secondary Button
                          </Button>
                          <Button variant="link" className="text-primary underline-offset-4 hover:underline hover:text-[color:var(--accent-color)] transition-colors">
                            Link Button
                          </Button>
                        </div>
                      </div>

                      {/* Dashboard Content Example */}
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-lg font-medium mb-2" style={{ fontFamily: theme.typography.fontFamily }}>
                            Dashboard Overview
                          </h4>
                          <p className="text-sm" style={{ color: theme.colors.secondary, fontFamily: theme.typography.fontFamily }}>
                            Welcome to your organization workspace.
                          </p>
                        </div>
                        <div className="grid gap-4">
                          <div className="p-4 border rounded">
                            <h5 className="font-medium mb-2" style={{ fontFamily: theme.typography.fontFamily }}>
                              Team Activity
                            </h5>
                            <div className="w-full bg-muted rounded-full h-2 mb-2">
                              <div 
                                className="h-2 rounded-full"
                                style={{ 
                                  width: '65%',
                                  backgroundColor: theme.colors.accent 
                                }}
                              />
                            </div>
                            <p className="text-sm" style={{ color: theme.colors.secondary, fontFamily: theme.typography.fontFamily }}>
                              65% Complete
                            </p>
                          </div>
                          <div className="p-4 border rounded">
                            <h5 className="font-medium mb-2" style={{ fontFamily: theme.typography.fontFamily }}>
                              Upcoming Deadlines
                            </h5>
                            <p className="text-sm mb-2" style={{ color: theme.colors.secondary, fontFamily: theme.typography.fontFamily }}>
                              Project due in 3 days
                            </p>
                            <Button 
                              size="sm"
                              variant="outline"
                              className="border-[color:var(--accent-color)] text-[color:var(--accent-color)] hover:bg-[color:var(--accent-color)] hover:text-white transition-colors flex items-center gap-2"
                            >
                              <AlertCircle className="h-4 w-4 mr-1 text-[color:var(--accent-color)]" />
                              Important!
                            </Button>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-lg font-medium mb-3" style={{ fontFamily: theme.typography.fontFamily }}>
                            Actions
                          </h4>
                          <div className="flex gap-2 flex-wrap">
                            <Button 
                              size="sm"
                              className="bg-primary text-primary-foreground hover:bg-[color:var(--accent-color)] transition-colors"
                            >
                              View Workspace
                            </Button>
                            <Button 
                              size="sm"
                              className="bg-secondary text-secondary-foreground hover:bg-[color:var(--accent-color)] hover:text-white transition-colors"
                            >
                              My Profile
                            </Button>
                            <Button 
                              size="sm"
                              variant="outline"
                              className="border-[color:var(--accent-color)] text-[color:var(--accent-color)] hover:bg-[color:var(--accent-color)] hover:text-white transition-colors"
                            >
                              Settings
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Close Button at bottom right */}
                      <div className="flex justify-end mt-8">
                        <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>



                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => form.handleSubmit(onSubmit)()}
                  disabled={isSaving || !isDirty}
                >
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Branding
                </Button>

                
              </div>
            </CardContent>
          </Card>

          
        </form>
      </Form>
      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={handleConfirmCancel}
        onCancel={handleDismissCancel}
      />

      {/* Media Manager Dialog */}
      <MediaManager
        isOpen={mediaManagerOpen}
        onClose={() => setMediaManagerOpen(false)}
        isPublic={true}
        contentType={mediaManagerType}
        onFileSelected={handleMediaFileSelected}
        title={mediaManagerType === 'logo' ? "Select Logo" : "Select Favicon"}
        description={mediaManagerType === 'logo' ? "Choose or upload a logo for your organization" : "Choose or upload a favicon for your organization"}
        allowedTypes={['image/*']}
        maxFileSize={5 * 1024 * 1024} // 5MB
      />
    </div>
  )
}
