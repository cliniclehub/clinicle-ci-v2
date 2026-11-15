"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import { FormNavigation, FormNavigationItem } from "@/components/ui/form-navigation"
import { useRoles } from "@/lib/contexts/role-context"

import { BasicInfoSection } from "./organization-sections/basic-info-section-v2"
import { BrandingSection } from "./organization-sections/branding-section-v2"
import { ContactSection } from "./organization-sections/contact-section-v2"
import { LandingPageSection } from "./organization-sections/landing-page-section"
import { LegalSection } from "./organization-sections/legal-section-v2"
import { NotificationSettingsSection } from "./organization-sections/notification-settings-section"
import { Organization } from "@/lib/types/organization-schema"

const ORGANIZATION_SECTIONS = [
  "basic-info",
  "branding",
  "landing-page",
  "contact",
  "legal",
  "notification-settings",
] as const

type OrganizationSectionId = (typeof ORGANIZATION_SECTIONS)[number]

function isOrganizationSectionId(value: string | null): value is OrganizationSectionId {
  return Boolean(value && ORGANIZATION_SECTIONS.includes(value as OrganizationSectionId))
}

interface OrganizationFormProps {
  organization?: Organization
  mode: "create" | "edit"
  isOrgAdmin?: boolean
  layout?: "sidebar" | "grouped-tabs"
  onSuccess?: (organization: Organization) => void
}

export function OrganizationForm({
  organization,
  mode = "create",
  isOrgAdmin = false,
  onSuccess,
}: OrganizationFormProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { activeRole } = useRoles()
  const isSuperAdmin = activeRole === "super_admin"
  const [activeSection, setActiveSection] = useState<OrganizationSectionId>(() => {
    const section = searchParams.get("section")
    return isOrganizationSectionId(section) ? section : "basic-info"
  })
  const [dirtySection, setDirtySection] = useState<string | null>(null)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const [pendingSection, setPendingSection] = useState<string | null>(null)
  const currentDirtySectionRef = useRef<string | null>(null)

  const navigationItems: FormNavigationItem[] = useMemo(
    () => [
      { id: "basic-info", label: "Basic Info", isDirty: dirtySection === "basic-info" },
      { id: "branding", label: "Branding", isDirty: dirtySection === "branding" },
      { id: "landing-page", label: "Landing Page", isDirty: dirtySection === "landing-page" },
      { id: "contact", label: "Contact", isDirty: dirtySection === "contact" },
      { id: "legal", label: "Legal", isDirty: dirtySection === "legal" },
      { id: "notification-settings", label: "Notifications", isDirty: dirtySection === "notification-settings" },
    ],
    [dirtySection]
  )

  const applySectionChange = useCallback(
    (sectionId: OrganizationSectionId) => {
      setActiveSection(sectionId)
      const params = new URLSearchParams(searchParams.toString())
      params.set("section", sectionId)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    const section = searchParams.get("section")
    if (isOrganizationSectionId(section) && section !== activeSection) {
      setActiveSection(section)
    }
  }, [activeSection, searchParams])

  const handleSectionChange = (sectionId: string) => {
    if (!isOrganizationSectionId(sectionId)) return
    if (mode === "create" && sectionId !== "basic-info") {
      toast.info("Please complete the basic information first to access other sections")
      return
    }

    const currentDirtySection = currentDirtySectionRef.current
    if (currentDirtySection && currentDirtySection !== sectionId) {
      setPendingSection(sectionId)
      setShowDirtyDialog(true)
      return
    }

    applySectionChange(sectionId)
  }

  const handleDirtyChange = (sectionId: string, isDirty: boolean) => {
    if (isDirty && sectionId !== activeSection) return
    const newDirtySection = isDirty ? sectionId : null
    currentDirtySectionRef.current = newDirtySection
    setDirtySection(newDirtySection)
  }

  const handleCancel = () => {
    router.back()
  }

  const handleSuccess = (data: Organization) => {
    onSuccess?.(data)
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <Card className="p-4">
            <FormNavigation
              items={navigationItems}
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
              orientation="vertical"
              className="lg:block hidden"
            />
            <FormNavigation
              items={navigationItems}
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
              orientation="horizontal"
              className="lg:hidden"
            />
          </Card>
        </aside>
        <div className="space-y-6">
          {activeSection === "basic-info" && (
            <BasicInfoSection
              organization={organization}
              mode={mode}
              isOrgAdmin={isOrgAdmin}
              isSuperAdmin={isSuperAdmin}
              onDirtyChange={(isDirty) => handleDirtyChange("basic-info", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "branding" && (
            <BrandingSection
              organization={organization}
              isOrgAdmin={isOrgAdmin}
              onDirtyChange={(isDirty) => handleDirtyChange("branding", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "landing-page" && (
            <LandingPageSection
              organization={organization}
              isOrgAdmin={isOrgAdmin}
              onDirtyChange={(isDirty) => handleDirtyChange("landing-page", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "contact" && (
            <ContactSection
              organization={organization}
              isOrgAdmin={isOrgAdmin}
              onDirtyChange={(isDirty) => handleDirtyChange("contact", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "legal" && (
            <LegalSection
              organization={organization}
              isOrgAdmin={isOrgAdmin}
              onDirtyChange={(isDirty) => handleDirtyChange("legal", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "notification-settings" && organization && (
            <NotificationSettingsSection
              organization={organization}
              onDirtyChange={(isDirty) => handleDirtyChange("notification-settings", isDirty)}
              onCancel={handleCancel}
            />
          )}
        </div>
      </div>

      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={() => {
          setShowDirtyDialog(false)
          setDirtySection(null)
          currentDirtySectionRef.current = null
          if (pendingSection && isOrganizationSectionId(pendingSection)) {
            applySectionChange(pendingSection)
            setPendingSection(null)
          } else {
            router.back()
          }
        }}
        onCancel={() => {
          setShowDirtyDialog(false)
          setPendingSection(null)
        }}
      />
    </>
  )
}
