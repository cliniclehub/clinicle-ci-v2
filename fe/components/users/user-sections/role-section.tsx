"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

import { listOrganizations } from "@/lib/actions/organizations/organizations-org-actions"
import { getAvailableRoles, updateUserRole } from "@/lib/actions/users/users-org-actions"
import { OrganizationDropdown } from "@/lib/types/organization-schema"
import { User } from "@/lib/types/user-schema"

// Schema for this section
const roleSchema = z.object({
  organizationId: z.string().min(1, "Organization is required"),
  roleKeys: z.array(z.string()).min(1, "At least one role is required"),
})

type RoleFormData = z.infer<typeof roleSchema>

interface RoleSectionProps {
  user?: User
  defaultOrganizationId?: string
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
}

const ROLE_HIERARCHY = {
  super_admin: { label: "Super Admin", level: 1 },
  org_admin: { label: "Organization Admin", level: 2 },
  user: { label: "User", level: 3 },
}

export function RoleSection({
  user,
  defaultOrganizationId,
  onDirtyChange,
  onCancel,
}: RoleSectionProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [organizations, setOrganizations] = useState<OrganizationDropdown[]>([])
  const [availableRoles, setAvailableRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const form = useForm<RoleFormData>({
    resolver: zodResolver(roleSchema),
    defaultValues: {
      organizationId: defaultOrganizationId || user?.organizationId || "",
      roleKeys: user?.roles || [],
    },
  })

  const { formState: { isDirty } } = form

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (user) {
      form.reset({
        organizationId: user.organizationId || "",
        roleKeys: user.roles || [],
      })
    }
  }, [user, form])

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // Fetch organizations
      const orgResponse = await listOrganizations( )
      if (orgResponse.status === "success" && orgResponse.data) {
        setOrganizations(orgResponse.data as any)
      }

      // Fetch available roles
      const rolesResponse = await getAvailableRoles()
      if (rolesResponse.status === "success" && rolesResponse.data) {
        setAvailableRoles(rolesResponse.data)
      }
    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (data: RoleFormData) => {
    if (!user) return

    setIsSaving(true)
    
    try {
      const response = await updateUserRole(user.id, {
        organizationId: data.organizationId,
        roleKeys: data.roleKeys,
      })
      
      if (response.status === "success") {
        toast.success("Role information saved successfully")
        form.reset(data)
      } else {
        toast.error(response.message || "Failed to save role information")
      }
    } catch (error) {
      toast.error("An error occurred while saving")
    } finally {
      setIsSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormSection
              id="role"
              title="Organization & Roles"
              description="User's organization assignment and permissions"
              isDirty={isDirty}
            >
              <FormField
                control={form.control}
                name="organizationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an organization" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name} ({org.domain})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The organization this user belongs to
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="roleKeys"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">User Roles</FormLabel>
                      <FormDescription>
                        Select the roles to assign to this user
                      </FormDescription>
                    </div>
                    <div className="space-y-3">
                      {Object.entries(ROLE_HIERARCHY)
                        .filter(([key]) => availableRoles.includes(key))
                        .map(([key, role]) => (
                          <FormField
                            key={key}
                            control={form.control}
                              name="roleKeys"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={key}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(key)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, key])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== key
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <div className="space-y-1 leading-none">
                                    <FormLabel className="font-normal">
                                      {role.label}
                                    </FormLabel>
                                    <FormDescription className="text-xs">
                                      Level {role.level} access
                                    </FormDescription>
                                  </div>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <FormFooter
              onSave={() => form.handleSubmit(onSubmit)()}
              onCancel={onCancel}
              isSaving={isSaving}
              isDirty={isDirty}
              isValid={form.formState.isValid}
              saveLabel="Save Roles"
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}