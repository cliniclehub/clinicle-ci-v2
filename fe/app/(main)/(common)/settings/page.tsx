"use client"

import { useEffect, useState } from "react"

import { UserForm } from "@/components/users/user-form"
import { Loader2 } from "lucide-react"

import { getPublicOrganizationData } from "@/lib/actions/organizations/organizations-org-actions"
import { getCurrentUser } from "@/lib/actions/users/users-me-actions"
import { Organization } from "@/lib/types/organization-schema"
import { User } from "@/lib/types/user-schema"
import { createClientLogger } from "@/lib/utils/logger-client"

const classLogger = createClientLogger("SettingsPage")

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const userResponse = await getCurrentUser()

        if (userResponse.status === "error") {
          setError(userResponse.message || "Failed to load profile")
          return
        }

        setUser(userResponse.data as User)

        try {
          const orgResponse = await getPublicOrganizationData()
          if (orgResponse.status === "success" && orgResponse.data) {
            setOrganization(orgResponse.data)
          }
        } catch (orgErr) {
          classLogger.warn("Failed to load organization data", { error: orgErr })
        }
      } catch (err) {
        classLogger.error("Failed to load profile", err as Error)
        setError("Failed to load profile")
      } finally {
        setLoading(false)
      }
    }
    void fetchData()
  }, [])

  const handleSuccess = async (updatedUser: User) => {
    setUser(updatedUser)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Loading profile...</span>
        </div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="flex-1 p-8">
        <h3 className="text-lg font-semibold mb-2 text-red-600">Error Loading Profile</h3>
        <p className="text-muted-foreground mb-4">{error || "Profile not found"}</p>
      </div>
    )
  }

  const isOrgAdmin = user.roles?.includes("org_admin") && !user.roles?.includes("super_admin")

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 overflow-x-hidden">
      <div>
        <h1 className="text-3xl font-bold">My Settings</h1>
        <p className="text-muted-foreground">Manage your account settings and profile information</p>
      </div>

      <UserForm
        mode="edit"
        user={user}
        organization={organization || undefined}
        isOrgAdmin={isOrgAdmin}
        userRole="me"
        isCurrentUser={true}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
