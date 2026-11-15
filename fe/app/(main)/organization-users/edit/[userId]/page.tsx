"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserForm } from "@/components/users/user-form"
import { getMyOrganization } from "@/lib/actions/organizations/organizations-org-actions"
import { getUser } from "@/lib/actions/users/users-org-actions"
import { useRoles } from "@/lib/contexts/role-context"
import { Organization } from "@/lib/types/organization-schema"
import { canManageOrgUserAccount, isOrgOwnerAccount } from "@/lib/types/role-schema"
import { User } from "@/lib/types/user-schema"
import { handleApiErrorResponse } from "@/lib/utils/api-error-handler"
import { createClientLogger } from "@/lib/utils/logger-client"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { use, useEffect, useState } from "react"
import { toast } from "sonner"

interface EditUserPageProps {
  params: Promise<{
    userId: string
  }>
}

export default function EditUserPage({ params }: EditUserPageProps) {
  const { userId } = use(params)
  const [user, setUser] = useState<User | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const logger = createClientLogger('EditUserPage')
  const { roles: viewerRoles } = useRoles()

  useEffect(() => {
    const loadData = async () => {
      const methodLogger = logger.forMethod('loadData')
      setLoading(true)
      setError(null)
      try {
        // Fetch user data
        const userResponse = await getUser(userId)

        // Check if error was handled by the helper function
        if (handleApiErrorResponse(userResponse, "Failed to load user")) {
          return
        } else if (userResponse.status === "success") {
          const userData = userResponse.data
          setUser(userData || null)
        }

        // Fetch organization data for conditional tab visibility
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
        }
      } catch (error: any) {
        methodLogger.error('Error loading data', error as Error, { userId })
        // Only handle validation errors specifically
        if (error.isAppError && error.errorType === 'ValidationError') {
          const fieldErrors = error.getAllValidationErrors?.() || []
          const errorMessage = fieldErrors
            .map((err: { field: string; message: string }) => `${err.field}: ${err.message}`)
            .join('\n')
          setError(errorMessage || error.message)
        } else {
          // All other errors go to toast
          toast.error(error.message || 'An unexpected error occurred')
        }
      } finally {
        setLoading(false)
      }
    }

    if (userId) {
      loadData()
    }
  }, [userId])

  const handleSuccess = (updatedUser: User) => {
    // Update local state with updated user
    setUser(updatedUser)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <span>Loading user...</span>
        </div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </div>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <h3 className="text-lg font-semibold mb-2 text-red-600">Error Loading User</h3>
              <p className="text-muted-foreground mb-4">{error || "User not found"}</p>
              <Button onClick={() => router.back()}>
                Back to Users
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!canManageOrgUserAccount(viewerRoles, user.roles) && isOrgOwnerAccount(user.roles)) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/organization-users")}
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Organization Owner</h1>
            <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 space-y-4">
              <h3 className="text-lg font-semibold">Account managed by platform</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Organization Owner accounts can only be managed by a platform administrator.
              </p>
              <Button onClick={() => router.push("/organization-users")}>
                Back to Users
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">
            Edit User{user ? ` - ${user.firstName} ${user.lastName}` : ''}
          </h1>
          {user && (
            <p className="text-sm text-muted-foreground mt-1">
              {user.email}
            </p>
          )}
        </div>
      </div>

      {/* User Form */}
      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
          <CardDescription>
            Update user details, status, and organization information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserForm
            user={user}
            organization={organization || undefined}
            mode="edit"
            isOrgAdmin={true}
            onSuccess={handleSuccess}
          />
          
        </CardContent>
      </Card>
    </div>
  )
}
