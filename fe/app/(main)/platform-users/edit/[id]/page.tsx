"use client"

import { ArrowLeft, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { use, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { UserForm } from "@/components/users/user-form"
import { getUser } from "@/lib/actions/users/users-platform-actions"
import { User } from "@/lib/types/user-schema"

interface EditUserPageProps {
  params: Promise<{ id: string }>
}

export default function EditUserPage({ params }: EditUserPageProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Unwrap params using React.use()
  const { id } = use(params)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await getUser(id)
        if (response.status === "success" && response.data) {
          setUser(response.data)
        } else {
          console.error("Failed to fetch user:", response.message)
        }
      } catch (error) {
        console.error("Error fetching user:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [id])

  const handleSuccess = (updatedUser: User) => {
    // Update local state with updated user
    setUser(updatedUser)
  }

  const handleBack = () => {
    router.push("/platform-users")
  }

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading user...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-2">User Not Found</h2>
          <p className="text-muted-foreground mb-4">
            The user you're looking for doesn't exist or you don't have permission to access it.
          </p>
          <Button onClick={handleBack}>
            Back to Users
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
          Back to Users
        </Button>
        
        <h1 className="text-3xl font-bold">Edit User</h1>
        <p className="text-muted-foreground">
          Update user information and permissions.
        </p>
      </div>
      
      <UserForm 
        mode="edit" 
        user={user}
        isOrgAdmin={false}
        userRole="super_admin"
        onSuccess={handleSuccess}
      />
    </div>
  )
}