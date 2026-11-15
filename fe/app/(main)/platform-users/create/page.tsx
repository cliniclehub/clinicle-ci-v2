"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2 } from "lucide-react"

import { UserForm } from "@/components/users/user-form"
import { User } from "@/lib/types/user-schema"

export default function CreateUserPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const handleSuccess = (user: User) => {
    toast.success("User created successfully")
    // Redirect to edit page to continue setting up the user
    router.push(`/platform-users/edit/${user.id}`)
  }

  const handleBack = () => {
    router.push("/platform-users")
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
        
        <h1 className="text-3xl font-bold">Create User</h1>
        <p className="text-muted-foreground">
          Add a new user to the platform
        </p>
      </div>

      <UserForm
        mode="create"
        userRole="super_admin"
        onSuccess={handleSuccess}
      />
      
      {saving && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card p-6 rounded-lg shadow-lg flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Creating user...</span>
          </div>
        </div>
      )}
    </div>
  )
}