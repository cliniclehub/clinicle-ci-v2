"use client"

import { useRouter } from "next/navigation"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Card } from "@/components/ui/card"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import { FormNavigation, FormNavigationItem } from "@/components/ui/form-navigation"

import { AuthSection } from "./user-sections/auth-section"
import { BasicInfoSection } from "./user-sections/basic-info-section"
import { RolesSection } from "./user-sections/roles-section"
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card"

import { Organization } from "@/lib/types/organization-schema"
import { canEditOrgUserRoles, canManageUserRoles } from "@/lib/types/role-schema"
import { User } from "@/lib/types/user-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { useRoles } from "@/lib/contexts/role-context"

interface UserFormProps {
  user?: User
  organization?: Organization
  mode: "create" | "edit"
  isOrgAdmin?: boolean
  isCurrentUser?: boolean // For settings page - uses /users/me endpoints
  organizationId?: string // For pre-selecting organization when creating from org users page
  userRole?: "super_admin" | "org_owner" | "org_admin" | "me"
  onSuccess?: (user: User) => void
}

export function UserForm({ 
  user, 
  organization,
  mode = "create",
  isOrgAdmin = false,
  isCurrentUser = false,
  organizationId,
  userRole = "me",
  onSuccess
}: UserFormProps) {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState("basic-info")
  const [dirtySection, setDirtySection] = useState<string | null>(null)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const [pendingSection, setPendingSection] = useState<string | null>(null)

  const logger = createClientLogger("UserForm")
  const { user: authUser } = useAuth()
  const { hasManagementRoles, roles: viewerRoles } = useRoles()

  const canEditRoles =
    canManageUserRoles(viewerRoles) && canEditOrgUserRoles(viewerRoles, user?.roles)
  const formUserRole: UserFormProps["userRole"] = viewerRoles.includes("super_admin")
    ? "super_admin"
    : viewerRoles.includes("org_owner")
      ? "org_owner"
      : viewerRoles.includes("org_admin")
        ? "org_admin"
        : "me"

  const isEditingSelf = Boolean(
    mode === "edit" &&
      !isCurrentUser &&
      user?.id &&
      authUser?.id &&
      user.id === authUser.id
  )
  const effectiveIsCurrentUser = isCurrentUser || isEditingSelf
  
  // Check whether the current user may manage organization users.
  const hasManagementPermissions = isOrgAdmin || hasManagementRoles || effectiveIsCurrentUser
  
  // Use ref to track current dirty state immediately
  const currentDirtySectionRef = useRef<string | null>(null)
  
  // Track if we've initialized from URL hash to prevent overwriting user selections
  const initializedFromHashRef = useRef(false)
  /** Skip one passive hash sync after applying hash→section in layout (avoids clobbering #auth with #basic-info on refresh). */
  const skipNextActiveSectionHashSyncRef = useRef(false)

  const navigationItems: FormNavigationItem[] = useMemo(
    () => [
      { id: "basic-info", label: "Profile", isDirty: dirtySection === "basic-info" },
      { id: "notifications", label: "Notifications", isDirty: dirtySection === "notifications" },
      { id: "roles", label: "Roles & Permissions", isDirty: dirtySection === "roles" },
      { id: "auth", label: "Authentication", isDirty: dirtySection === "auth" },
    ],
    [dirtySection]
  )

  // Filter navigation items based on organization settings and user type
  const filteredNavigationItems = navigationItems.filter(item => {
    // Always show basic info and auth
    if (item.id === "basic-info" || item.id === "auth") {
      return true
    }

    if (item.id === "notifications") {
      return effectiveIsCurrentUser === true
    }

    // For platform admin users creating/editing other users, show all tabs
    // Role restrictions are handled within the RolesSection component itself
    return true
  })

  // Debug logging for filtered navigation items
  useEffect(() => {
    logger.debug("Navigation items filtered", {
      isCurrentUser,
      isOrgAdmin,
      hasManagementRoles,
      hasManagementPermissions,
      organizationId: organization?.id,
      filteredItems: filteredNavigationItems.map(item => item.id)
    })
  }, [filteredNavigationItems, isCurrentUser, isOrgAdmin, hasManagementRoles, hasManagementPermissions, organization, logger])

  // Initialize active section from URL hash before paint (useLayoutEffect)
  // Fixes /settings#family not loading - ensures correct section is shown immediately
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || initializedFromHashRef.current) return

    const hash = window.location.hash.slice(1)
    if (hash) {
      const matchingItem = filteredNavigationItems.find(item => item.id === hash)
      if (matchingItem) {
        setActiveSection(matchingItem.id)
        skipNextActiveSectionHashSyncRef.current = true
      }
      initializedFromHashRef.current = true
    } else {
      initializedFromHashRef.current = true
    }
  }, [filteredNavigationItems])

  // Listen for hash changes (browser back/forward buttons)
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      if (hash) {
        const matchingItem = filteredNavigationItems.find(item => item.id === hash)
        if (matchingItem && matchingItem.id !== activeSection) {
          logger.info("Hash changed, updating active section", {
            hash,
            sectionId: matchingItem.id,
            currentSection: activeSection
          })
          // Only change if no dirty state or same section
          const currentDirtySection = currentDirtySectionRef.current
          if (!currentDirtySection || currentDirtySection === matchingItem.id) {
            setActiveSection(matchingItem.id)
          }
        }
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [filteredNavigationItems, activeSection, logger])

  // Check if current active section is still available, if not redirect to first available
  useEffect(() => {
    const isCurrentSectionAvailable = filteredNavigationItems.some(item => item.id === activeSection)
    if (!isCurrentSectionAvailable && filteredNavigationItems.length > 0) {
      logger.info("Current section no longer available, redirecting to first available section", {
        currentSection: activeSection,
        availableSections: filteredNavigationItems.map(item => item.id)
      })
      setActiveSection(filteredNavigationItems[0].id)
    }
  }, [filteredNavigationItems, activeSection, logger])

  // Update URL hash when active section changes (but not on initial mount from hash)
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!initializedFromHashRef.current) {
      return
    }
    if (skipNextActiveSectionHashSyncRef.current) {
      skipNextActiveSectionHashSyncRef.current = false
      return
    }

    const newHash = `#${activeSection}`
    const currentHash = window.location.hash
    if (currentHash !== newHash) {
      window.history.replaceState(null, '', `${window.location.pathname}${newHash}`)
      logger.debug("Updated URL hash for active section", {
        sectionId: activeSection,
        hash: newHash
      })
    }
  }, [activeSection, logger])

  const handleSectionChange = (sectionId: string) => {
    logger.info("Section change requested:", sectionId)
    
    // Prevent navigation to other sections during creation
    if (mode === "create" && sectionId !== "basic-info") {
      toast.info("Please complete the basic information first")
      return
    }

    // Use ref for immediate dirty state check
    const currentDirtySection = currentDirtySectionRef.current
    if (currentDirtySection && currentDirtySection !== sectionId) {
      setPendingSection(sectionId)
      setShowDirtyDialog(true)
    } else {
      setActiveSection(sectionId)
      // Update URL hash immediately when section changes
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `${window.location.pathname}#${sectionId}`)
      }
    }
  }

  const handleDirtyChange = (sectionId: string, isDirty: boolean) => {
    // Only update if this is the active section
    if (sectionId !== activeSection && isDirty) {
      return
    }
    
    // If clearing dirty state, only clear if this section was the dirty one
    if (!isDirty && dirtySection !== sectionId) {
      return
    }
    
    const newDirtySection = isDirty ? sectionId : null
    
    // Update ref immediately for instant access
    currentDirtySectionRef.current = newDirtySection
    setDirtySection(newDirtySection)
  }

  const handleCancel = () => {
    if (dirtySection) {
      setShowDirtyDialog(true)
    } else {
      router.back()
    }
  }

  const handleSuccess = (data: User) => {
    // Clear dirty state
    setDirtySection(null)
    currentDirtySectionRef.current = null
    
    // Call the onSuccess callback if provided
    onSuccess?.(data)
  }

  return (
    <>
      

      <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Navigation */}
        <aside className="min-w-0 lg:sticky lg:top-20 lg:h-fit">
          <Card className="overflow-hidden p-4">
            <FormNavigation
              items={filteredNavigationItems}
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
              orientation="vertical"
              className="lg:block hidden"
            />
            <FormNavigation
              items={filteredNavigationItems}
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
              orientation="horizontal"
              className="lg:hidden min-w-0"
            />
          </Card>
        </aside>

        {/* Form Sections */}
        <div className="min-w-0 space-y-6">
          {activeSection === "basic-info" && (
            <BasicInfoSection
              user={user}
              organization={organization}
              mode={mode}
              isOrgAdmin={isOrgAdmin}
              isCurrentUser={effectiveIsCurrentUser}
              organizationId={organizationId}
              userRole={formUserRole}
              onDirtyChange={(isDirty) => handleDirtyChange("basic-info", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "roles" && (
            <RolesSection
              user={user}
              isCurrentUser={effectiveIsCurrentUser}
              userRole={formUserRole}
              canEditRoles={canEditRoles}
              onDirtyChange={(isDirty) => handleDirtyChange("roles", isDirty)}
              onCancel={handleCancel}
              onSuccess={handleSuccess}
            />
          )}
          {activeSection === "notifications" && user && (
            <NotificationPreferencesCard />
          )}
          {/* Always mount when user exists (hidden unless active) — same pattern as #family; fixes refresh on #auth spinner / no data */}
          {user && (
            <div
              className={`min-w-0 ${activeSection === "auth" ? "" : "hidden"}`}
              aria-hidden={activeSection !== "auth"}
            >
              <AuthSection
                user={user}
                isCurrentUser={effectiveIsCurrentUser}
                userRole={formUserRole}
                onDirtyChange={(isDirty) => handleDirtyChange("auth", isDirty)}
                onCancel={handleCancel}
                onSuccess={handleSuccess}
                onUserSnapshotUpdated={(u) => onSuccess?.(u)}
              />
            </div>
          )}
        </div>
      </div>

      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={() => {
          setShowDirtyDialog(false)
          setDirtySection(null)
          currentDirtySectionRef.current = null
          if (pendingSection) {
            setActiveSection(pendingSection)
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
