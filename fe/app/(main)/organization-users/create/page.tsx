"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserForm } from "@/components/users/user-form"
import { getMyOrganization } from "@/lib/actions/organizations/organizations-org-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import { Organization } from "@/lib/types/organization-schema"
import { User } from "@/lib/types/user-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import { ArrowLeft, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export default function CreateUserPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const logger = createClientLogger('CreateUserPage')

  useEffect(() => {
    const loadOrganization = async () => {
      try {
        const orgResponse = await getMyOrganization()
        if (orgResponse.status === "success" && orgResponse.data) {
          setOrganization(orgResponse.data)
          logger.info("Organization data loaded successfully", { 
            orgId: orgResponse.data.id, 
            orgName: orgResponse.data.name
          })
        } else {
          logger.info("No organization data found")
        }
      } catch (orgErr) {
        logger.warn("Failed to load organization data", { error: orgErr })
        // Don't set error for organization fetch failure, just log it
      } finally {
        setLoading(false)
      }
    }

    loadOrganization()
  }, [])

  const handleSuccess = (user: User) => {
    toast.success("User created successfully")
    // Redirect to edit page to continue setting up the user
    router.push(`/organization-users/edit/${user.id}`)
  }

  const handleBack = () => {
    router.back()
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <span>Loading organization settings...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Link href="/organization-users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Create User</h1>
        </div>
      </div>

      {/* User Form */}
      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
          <CardDescription>
            Enter user details and settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserForm
            mode="create"
            organization={organization || undefined}
            isOrgAdmin={true}
            organizationId={user?.organizationId || ""}
            onSuccess={handleSuccess}
          />
        </CardContent>
      </Card>
    </div>
  )
}
