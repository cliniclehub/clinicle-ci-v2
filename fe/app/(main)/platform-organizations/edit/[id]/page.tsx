"use client"

import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { use, useEffect, useState } from "react"

import { OrganizationForm } from "@/components/organization/organization-form"
import { Button } from "@/components/ui/button"
import { getOrganization } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization } from "@/lib/types/organization-schema"
import { createClientLogger } from "@/lib/utils/logger-client"

interface EditOrganizationPageProps {
  params: Promise<{ id: string }>
}

export default function EditOrganizationPage({ params }: EditOrganizationPageProps) {
  const router = useRouter()
  const logger = createClientLogger("EditOrganizationPage")
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Unwrap params using React.use()
  const { id } = use(params)

  useEffect(() => {
    const fetchOrganization = async () => {
      try {
        const response = await getOrganization(id)
        if (response.status === "success" && response.data) {
          setOrganization(response.data)
        } else {
          logger.error(
            "Failed to fetch organization",
            new Error(response.message || "Unknown error"),
            { organizationId: id }
          )
        }
      } catch (error) {
        logger.error("Error fetching organization", error as Error, { organizationId: id })
      } finally {
        setLoading(false)
      }
    }

    fetchOrganization()
  }, [id])

  const handleSuccess = (updatedOrganization: Organization) => {
    // Optionally show success message or update local state
    setOrganization(updatedOrganization)
  }

  const handleBack = () => {
    router.push("/platform-organizations")
  }

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading organization...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!organization) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-2">Organization Not Found</h2>
          <p className="text-muted-foreground mb-4">
            The organization you're looking for doesn't exist or you don't have permission to access it.
          </p>
          <Button onClick={handleBack}>
            Back to Organizations
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="mb-4 flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Organizations
        </Button>
        
        <h1 className="text-3xl font-bold">
          Edit Organization
          {organization && (
            <span className="text-muted-foreground font-normal ml-2">
              - {organization.name}
            </span>
          )}
        </h1>
        <p className="text-muted-foreground">
          Update organization information and configuration.
        </p>
      </div>
      
      <OrganizationForm
        layout="grouped-tabs"
        mode="edit"
        organization={organization}
        onSuccess={handleSuccess}
      />
    </div>
  )
}