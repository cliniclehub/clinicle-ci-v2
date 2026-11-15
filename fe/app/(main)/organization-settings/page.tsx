"use client"

import { Building2, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { OrganizationForm } from "@/components/organization/organization-form"
import { getMyOrganization } from "@/lib/actions/organizations/organizations-org-actions"
import { Organization } from "@/lib/types/organization-schema"
import { createClientLogger } from "@/lib/utils/logger-client"

export default function OrgAdminOrganizationPage() {
  const logger = createClientLogger("OrgAdminOrganizationPage")
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const response = await getMyOrganization()
        if (response.status === "success" && response.data) {
          setOrganization(response.data as Organization)
        } else {
          setError(response.message || "Failed to fetch organization")
        }
      } catch (err) {
        logger.error("Error fetching organization", err as Error, {})
        setError("An error occurred while fetching the organization")
      } finally {
        setLoading(false)
      }
    }

    fetchOrganization()
  }, [])

  const handleSuccess = (updatedOrg: Organization) => {
    setOrganization(updatedOrg)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading organization settings...</p>
        </div>
      </div>
    )
  }

  if (error || !organization) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <p className="text-lg font-medium">Unable to Load Settings</p>
            <p className="text-sm text-muted-foreground">{error || "Organization not found"}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Organization Settings</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Manage your organization&apos;s information, branding, and contact details.
          </p>
        </div>
      </div>

      <OrganizationForm
        organization={organization}
        mode="edit"
        isOrgAdmin={true}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
