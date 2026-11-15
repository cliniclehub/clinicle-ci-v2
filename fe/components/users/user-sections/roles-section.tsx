"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { FormFooter } from "@/components/ui/form-footer"
import { FormSection } from "@/components/ui/form-section"
import { Shield } from "lucide-react"

import { updateUserRoles as updateUserRolesOrg } from "@/lib/actions/users/users-org-actions"
import { updateUserRoles as updateUserRolesPlatform } from "@/lib/actions/users/users-platform-actions"
import { listAssignableRoles, type RoleDto } from "@/lib/actions/roles/roles-org-actions"
import { getManageableRoles, type RoleId } from "@/lib/types/role-schema"
import { User } from "@/lib/types/user-schema"

// Fallback system roles when assignable API is unavailable
const AVAILABLE_ROLES = [
  {
    key: "super_admin",
    label: "Super Admin",
    description: "Full platform access and management across all organizations",
    dangerous: true,
  },
  {
    key: "org_owner",
    label: "Organization Owner",
    description:
      "Full organization management plus assigning organization admins. Only a platform super admin can grant this role.",
    dangerous: false,
  },
  {
    key: "org_admin",
    label: "Organization Admin",
    description:
      "Organization management: settings, users, email, notifications, and media. Only Organization Owners can assign this role.",
  },
  {
    key: "user",
    label: "User",
    description: "Organization user with access to the dashboard and personal settings",
  },
]

// Schema for roles section
const rolesSchema = z.object({
  roles: z.array(z.string()).min(1, "At least one role must be selected"),
})

type RolesFormData = z.infer<typeof rolesSchema>

interface RolesSectionProps {
  user?: User
  isCurrentUser?: boolean
  userRole?: "super_admin" | "org_owner" | "org_admin" | "me"
  /** When false, roles are view-only. Defaults to true. */
  canEditRoles?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (user: User) => void
}

export function RolesSection({
  user,
  isCurrentUser,
  userRole = "me",
  canEditRoles = true,
  onDirtyChange,
  onCancel,
  onSuccess,
}: RolesSectionProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const [assignableRoles, setAssignableRoles] = useState<RoleDto[] | null>(null)

  useEffect(() => {
    if (userRole !== "org_admin" && userRole !== "org_owner") return
    let mounted = true
    void listAssignableRoles().then((response) => {
      if (!mounted) return
      if (response.status === "success" && response.data) {
        setAssignableRoles(response.data)
      }
    })
    return () => {
      mounted = false
    }
  }, [userRole])

  // Filter available roles based on viewer role
  // Only super admins can assign super_admin / org_owner; only org owners can assign org_admin
  const availableRoles =
    userRole === "super_admin"
      ? AVAILABLE_ROLES
      : (() => {
          const manageable =
            userRole === "org_owner" || userRole === "org_admin"
              ? new Set(getManageableRoles(userRole as RoleId))
              : new Set<RoleId>()
          const source = assignableRoles
            ? assignableRoles.map((role) => ({
                key: role.key,
                label: role.label,
                description: role.isSystem
                  ? "System role"
                  : role.permissions?.length
                    ? role.permissions.join(", ")
                    : "Role",
                dangerous: false,
              }))
            : AVAILABLE_ROLES.filter(
                (role) => role.key !== "super_admin" && role.key !== "org_owner"
              )
          return source.filter((role) => manageable.has(role.key as RoleId))
        })()

  const showReadOnlyRoles = Boolean(user && (isCurrentUser || !canEditRoles))

  // Show read-only view when editing own roles or when viewer cannot assign roles
  if (showReadOnlyRoles && user) {
    return (
      <Card>
        <CardContent className="pt-6">
          <FormSection
            id="roles"
            title="Roles & Permissions"
            description={
              isCurrentUser
                ? "Your current roles and permissions within the organization"
                : "Roles assigned to this user within the organization"
            }
            isDirty={false}
          >
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-3">Current Roles</p>
                <div className="space-y-3">
                  {(user.roles || []).map((roleKey) => {
                    const role = AVAILABLE_ROLES.find((r) => r.key === roleKey)
                    if (!role) return null
                    
                    return (
                      <div
                        key={role.key}
                        className={`
                          flex items-start space-x-3 p-4 rounded-lg border
                          ${role.dangerous 
                            ? 'border-red-500 bg-red-50 dark:bg-red-950' 
                            : 'border-primary bg-primary/5'
                          }
                        `}
                      >
                        <Shield className={`h-5 w-5 mt-0.5 ${
                          role.dangerous ? 'text-red-600' : 'text-primary'
                        }`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${
                              role.dangerous ? 'text-red-700' : ''
                            }`}>
                              {role.label}
                            </span>
                            <Badge 
                              variant={role.dangerous ? "destructive" : "secondary"}
                              className="ml-auto"
                            >
                              Active
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {role.description}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {isCurrentUser ? (
                    <>
                      <strong>Note:</strong> You cannot modify your own roles. Please contact an administrator if you need to change your permissions.
                    </>
                  ) : (
                    <>
                      <strong>Note:</strong> Role assignment is restricted to organization administrators. Contact an org admin if this user&apos;s permissions need to change.
                    </>
                  )}
                </p>
              </div>
            </div>
          </FormSection>
        </CardContent>
      </Card>
    )
  }

  // Show message if accessed during creation mode
  if (!user) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">Roles & Permissions</h3>
            <p className="text-muted-foreground">
              Role assignment will be available after creating the user.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const form = useForm<RolesFormData>({
    resolver: zodResolver(rolesSchema),
    defaultValues: {
      roles: user?.roles || ["user"],
    },
  })

  const { formState: { isDirty } } = form

  // Update parent component when dirty state changes
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Update form when user data changes
  useEffect(() => {
    if (user) {
      form.reset({
        roles: user.roles || ["user"],
      })
    }
  }, [user?.id])

  const handleCancel = () => {
    if (isDirty) {
      setShowDirtyDialog(true)
    } else {
      onCancel()
    }
  }

  const handleConfirmCancel = () => {
    form.reset()
    setShowDirtyDialog(false)
    onCancel()
  }

  const handleDismissCancel = () => {
    setShowDirtyDialog(false)
  }

  const onSubmit = async (data: RolesFormData) => {
    if (!user) return

    setIsSaving(true)
    
    try {
      // Choose the correct update function based on user role
      const updateUserRoles =
        userRole === "super_admin" ? updateUserRolesPlatform : updateUserRolesOrg
      const response = await updateUserRoles(user.id, data.roles)
      
      if (response.status === "success" && response.data) {
        toast.success("Roles updated successfully")
        form.reset(data)
        onSuccess?.(response.data)
      } else {
        toast.error(response.message || "Failed to update roles")
      }
    } catch (error) {
      toast.error("An error occurred while saving")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormSection
              id="roles"
              title="Roles & Permissions"
              description="Assign roles to grant specific permissions within the organization"
              isDirty={isDirty}
            >
              <FormField
                control={form.control}
                name="roles"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User Roles</FormLabel>
                    <FormDescription>
                      Select one or more roles for this user
                    </FormDescription>
                    <div className="space-y-3 mt-4">
                      {availableRoles.map((role) => (
                        <div
                          key={role.key}
                          className={`
                            flex items-start space-x-3 p-4 rounded-lg border
                            ${field.value.includes(role.key) 
                              ? role.dangerous 
                                ? 'border-red-500 bg-red-50 dark:bg-red-950' 
                                : 'border-primary bg-primary/5'
                              : 'border-border hover:border-border'
                            }
                          `}
                        >
                          <FormControl>
                            <Checkbox
                              checked={field.value.includes(role.key)}
                              onCheckedChange={(checked) => {
                                const newValue = checked
                                  ? [...field.value, role.key]
                                  : field.value.filter((v) => v !== role.key)
                                field.onChange(newValue)
                              }}
                            />
                          </FormControl>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Shield className={`h-4 w-4 ${
                                role.dangerous ? 'text-red-600' : 'text-muted-foreground'
                              }`} />
                              <span className={`font-medium ${
                                role.dangerous ? 'text-red-700' : ''
                              }`}>
                                {role.label}
                              </span>
                              {field.value.includes(role.key) && (
                                <Badge 
                                  variant={role.dangerous ? "destructive" : "secondary"}
                                  className="ml-auto"
                                >
                                  Active
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {role.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Current Permissions Summary */}
              {form.watch("roles").length > 0 && (
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Current Permissions</h4>
                  <div className="flex flex-wrap gap-2">
                    {form.watch("roles").map((role) => {
                      const roleInfo = availableRoles.find((r) => r.key === role)
                      return (
                        <Badge 
                          key={role} 
                          variant={roleInfo?.dangerous ? "destructive" : "secondary"}
                        >
                          <Shield className="h-3 w-3 mr-1" />
                          {roleInfo?.label || role}
                        </Badge>
                      )
                    })}
                  </div>
                </div>
              )}
            </FormSection>

            <FormFooter
              onSave={() => form.handleSubmit(onSubmit)()}
              onCancel={handleCancel}
              isSaving={isSaving}
              isDirty={isDirty}
              saveLabel="Save Roles"
            />
          </form>
        </Form>
      </CardContent>
      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={handleConfirmCancel}
        onCancel={handleDismissCancel}
      />
    </Card>
  )
}
