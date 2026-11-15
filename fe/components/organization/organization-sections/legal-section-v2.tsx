"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Textarea } from "@/components/ui/textarea"

import { DirtyFormDialog } from "@/components/ui/dirty-form-dialog"
import { updateMyOrganizationLegal } from "@/lib/actions/organizations/organizations-org-actions"
import { updateOrganizationLegal as updateOrganizationLegalPlatform } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization, OrganizationLegal, organizationLegalSchema } from "@/lib/types/organization-schema"

interface LegalSectionProps {
  organization?: Organization
  isOrgAdmin?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (organization: Organization) => void
}

export function LegalSection({
  organization,
  isOrgAdmin = false,
  onDirtyChange,
  onCancel,
  onSuccess,
}: LegalSectionProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)

  // Show message if accessed during creation mode
  if (!organization) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">Legal Documents</h3>
            <p className="text-muted-foreground">
              Legal documents can be configured after creating the organization.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const form = useForm<OrganizationLegal>({
    resolver: zodResolver(organizationLegalSchema),
    defaultValues: {
      termsOfUse: organization?.termsOfUse || "",
      privacyPolicy: organization?.privacyPolicy || "",
    },
  })  

  const { formState: { isDirty } } = form

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (organization) {
      form.reset({
        termsOfUse: organization.termsOfUse || "",
        privacyPolicy: organization.privacyPolicy || "",      
      }, { keepDirty: false }) // Explicitly clear dirty state when resetting
    }
  }, [organization, form])

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

  const onSubmit = async (data: OrganizationLegal) => {
    if (!organization) return

    setIsSaving(true)
    
    try {
      const response = isOrgAdmin
        ? await updateMyOrganizationLegal(data)
        : await updateOrganizationLegalPlatform(organization.id, data)
      
      if (response.status === "success") {
        toast.success("Legal information saved successfully")
        form.reset(data)
        // Use the updated organization data from the API response
        onSuccess?.(response.data || organization)
      } else {
        toast.error(response.message || "Failed to save legal information")
      }
    } catch (error) {
      toast.error("An error occurred while saving")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Legal Information</CardTitle>
              <CardDescription>
                Terms of use and privacy policy for the organization
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FormField
                control={form.control}
                name="termsOfUse"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terms of Use</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Enter the terms of use for this organization..."
                        className="min-h-[300px]"
                      />
                    </FormControl>
                    <FormDescription>
                      Terms and conditions that users must agree to
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="privacyPolicy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Privacy Policy</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Enter the privacy policy for this organization..."
                        className="min-h-[300px]"
                      />
                    </FormControl>
                    <FormDescription>
                      How the organization handles user data and privacy
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <FormFooter
            onSave={() => form.handleSubmit(onSubmit)()}
            onCancel={handleCancel}
            isSaving={isSaving}
            isDirty={isDirty}
            isValid={form.formState.isValid}
            saveLabel="Save Legal Info"
          />
        </form>
      </Form>
      <DirtyFormDialog
        open={showDirtyDialog}
        onConfirm={handleConfirmCancel}
        onCancel={handleDismissCancel}
      />
    </div>
  )
}