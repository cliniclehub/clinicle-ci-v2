"use client"

import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"

import { OrganizationForm } from "@/components/organization/organization-form"
import { Button } from "@/components/ui/button"
import { Organization } from "@/lib/types/organization-schema"

export default function CreateOrganizationPage() {
  const router = useRouter()

  const handleSuccess = (organization: Organization) => {
    router.push(`/platform-organizations/edit/${organization.id}`)
  }

  const handleBack = () => {
    router.push("/platform-organizations")
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
        
        <h1 className="text-3xl font-bold">Create Organization</h1>
        <p className="text-muted-foreground">
          Set up a new organization with basic information and configuration.
        </p>
      </div>
      
      <OrganizationForm
        layout="grouped-tabs"
        mode="create"
        onSuccess={handleSuccess}
      />
    </div>
  )
}