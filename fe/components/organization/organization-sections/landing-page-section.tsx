"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { updateMyOrganizationLandingPage } from "@/lib/actions/organizations/organizations-org-actions"
import { updateOrganizationLandingPagePlatform } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization } from "@/lib/types/organization-schema"
import { createClientLogger } from "@/lib/utils/logger-client"

interface LandingPageSectionProps {
  organization?: Organization
  isOrgAdmin?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess: (organization: Organization) => void
}

export function LandingPageSection({
  organization,
  isOrgAdmin = false,
  onDirtyChange,
  onCancel,
  onSuccess
}: LandingPageSectionProps) {
  const logger = createClientLogger("LandingPageSection")
  const [landingPageHtml, setLandingPageHtml] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [originalHtml, setOriginalHtml] = useState("")

  useEffect(() => {
    const html = organization?.landingPageHtml || ""
    setLandingPageHtml(html)
    setOriginalHtml(html)
  }, [organization])

  useEffect(() => {
    const hasChanged = landingPageHtml !== originalHtml
    onDirtyChange(hasChanged)
  }, [landingPageHtml, originalHtml, onDirtyChange])

  const handleSave = async () => {
    if (!organization?.id) {
      toast.error("Organization not found")
      return
    }

    setIsSaving(true)
    try {
      const result = isOrgAdmin
        ? await updateMyOrganizationLandingPage({
            landingPageHtml: landingPageHtml,
          })
        : await updateOrganizationLandingPagePlatform(organization.id, {
            landingPageHtml: landingPageHtml,
          })

      if (result.status === "success") {
        toast.success("Landing page saved successfully")
        setOriginalHtml(landingPageHtml)
        onSuccess(result.data)
      } else {
        toast.error(result.message || "Failed to save landing page")
      }
    } catch (error) {
      logger.error("Failed to save landing page", error as Error, {
        organizationId: organization.id,
      })
      toast.error("Failed to save landing page")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Landing Page</CardTitle>
          <CardDescription>
            Paste custom HTML for your organization&apos;s public landing page. Leave empty to use
            the default layout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="landing-page-html">HTML content</Label>
            <Textarea
              id="landing-page-html"
              value={landingPageHtml}
              onChange={(e) => setLandingPageHtml(e.target.value)}
              placeholder="<section>...</section>"
              className="min-h-[400px] font-mono text-sm"
              spellCheck={false}
              aria-label="Organization landing page HTML"
            />
            <p className="text-sm text-muted-foreground">
              Paste full HTML fragments or a complete page body. Images and links should use
              absolute URLs. Saved content is stored for this organization only.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4 pt-6 border-t">
        <div className="flex-1" />
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Landing Page"}
        </Button>
      </div>
    </div>
  )
}
