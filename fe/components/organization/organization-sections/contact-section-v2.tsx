"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Card, CardContent } from "@/components/ui/card"
import { CountrySelect } from "@/components/ui/country-select"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { updateMyOrganization } from "@/lib/actions/organizations/organizations-org-actions"
import { updateOrganization as updateOrganizationPlatform } from "@/lib/actions/organizations/organizations-platform-actions"
import { Organization, OrganizationContact, organizationContactSchema } from "@/lib/types/organization-schema"

interface ContactSectionProps {
  organization?: Organization
  isOrgAdmin?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (organization: Organization) => void
}

const DEFAULT_CONTACT_TOPICS = [
  { key: "general", label: "General" },
  { key: "technical", label: "Technical issue" },
  { key: "billing", label: "Billing" },
  { key: "account", label: "Account" },
  { key: "other", label: "Other" },
] as const

const contactSectionSchema = organizationContactSchema.extend({
  supportTopicsText: z.string().optional(),
})

type ContactSectionFormData = z.infer<typeof contactSectionSchema>

function parseContactTopicLabels(siteTheme: Organization["siteTheme"]): string[] {
  const topics = siteTheme?.contactTopics
  if (!Array.isArray(topics) || topics.length === 0) {
    return DEFAULT_CONTACT_TOPICS.map((topic) => topic.label)
  }
  return topics
    .map((topic) => (typeof topic?.label === "string" ? topic.label.trim() : ""))
    .filter((label): label is string => Boolean(label))
}

function toContactTopicObjects(rawText?: string) {
  const labels = (rawText || "")
    .split("\n")
    .map((label) => label.trim())
    .filter(Boolean)

  const uniqueLabels = Array.from(new Set(labels))
  if (uniqueLabels.length === 0) {
    return [...DEFAULT_CONTACT_TOPICS]
  }

  const usedKeys = new Set<string>()
  return uniqueLabels.map((label, index) => {
    const baseKey = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `topic-${index + 1}`

    let key = baseKey
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${baseKey}-${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    return { key, label }
  })
}

export function ContactSection({
  organization,
  isOrgAdmin = false,
  onDirtyChange,
  onCancel,
  onSuccess,
}: ContactSectionProps) {
  const [isSaving, setIsSaving] = useState(false)

  // Show message if accessed during creation mode
  if (!organization) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">Contact Information</h3>
            <p className="text-muted-foreground">
              Contact information can be configured after creating the organization.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const form = useForm<ContactSectionFormData>({
    resolver: zodResolver(contactSectionSchema),
    defaultValues: {
      supportEmail: organization?.supportEmail || "",
      infoEmail: organization?.infoEmail || "",
      adminEmail: organization?.adminEmail || "",
      addressLine1: organization?.addressLine1 || "",
      addressLine2: organization?.addressLine2 || "",
      city: organization?.city || "",
      stateProvince: organization?.stateProvince || "",
      zipPostal: organization?.zipPostal || "",
      country: organization?.country || "",
      supportTopicsText: parseContactTopicLabels(organization?.siteTheme).join("\n"),
    },
  })

  const { formState: { isDirty } } = form

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (organization) {
      form.reset({
        supportEmail: organization.supportEmail || "",
        infoEmail: organization.infoEmail || "",
        adminEmail: organization.adminEmail || "",
        addressLine1: organization.addressLine1 || "",
        addressLine2: organization.addressLine2 || "",
        city: organization.city || "",
        stateProvince: organization.stateProvince || "",
        zipPostal: organization.zipPostal || "",
        country: organization.country || "",
        supportTopicsText: parseContactTopicLabels(organization.siteTheme).join("\n"),
      }, { keepDirty: false }) // Explicitly clear dirty state when resetting
    }
  }, [organization, form])

  const onSubmit = async (data: ContactSectionFormData) => {
    if (!organization) return

    setIsSaving(true)
    
    try {
      const contactPayload: OrganizationContact = {
        supportEmail: data.supportEmail,
        infoEmail: data.infoEmail,
        adminEmail: data.adminEmail,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        stateProvince: data.stateProvince,
        zipPostal: data.zipPostal,
        country: data.country,
      }
      const topics = toContactTopicObjects(data.supportTopicsText)
      const payload = {
        ...contactPayload,
        siteTheme: {
          ...(organization.siteTheme || {}),
          contactTopics: topics,
        },
      }

      const response = isOrgAdmin
        ? await updateMyOrganization(payload)
        : await updateOrganizationPlatform(organization.id, payload)
      
      if (response.status === "success") {
        toast.success("Contact information saved successfully")
        form.reset({
          ...data,
          supportTopicsText: topics.map((topic) => topic.label).join("\n"),
        })
        // Use the updated organization data from the API response
        onSuccess?.(response.data || organization)
      } else {
        toast.error(response.message || "Failed to save contact information")
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
              id="contact"
              title="Contact Information"
              description="Organization contact details and addresses"
              isDirty={isDirty}
            >
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Email Addresses</h4>
                
                <FormField
                  control={form.control}
                  name="supportEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Support Email</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="support@example.com" />
                      </FormControl>
                      <FormDescription>
                        Email for user support inquiries
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="infoEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Info Email</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="info@example.com" />
                      </FormControl>
                      <FormDescription>
                        General information email
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="adminEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reply-to Address</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="admin@example.com" />
                      </FormControl>
                      <FormDescription>
                        This is the default reply-to address for bulk or individual user emails.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="supportTopicsText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Form Topics</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value || ""}
                          className="min-h-[140px] resize-y"
                          placeholder={"General\nTechnical issue\nBilling\nAccount\nOther"}
                        />
                      </FormControl>
                      <FormDescription>
                        One topic per line for the public Contact page.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-medium">Organization Physical Address</h4>
                
                <FormField
                  control={form.control}
                  name="addressLine1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="123 Main Street" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="addressLine2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address Line 2</FormLabel>
                      <FormControl><Input {...field} placeholder="Suite or unit" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="New York" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stateProvince"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State/Province</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="NY" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="zipPostal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="10001" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <CountrySelect
                            value={field.value ?? ""}
                            onValueChange={field.onChange}
                            mode="name"
                            placeholder="Select country"
                            aria-label="Country"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </FormSection>

            <FormFooter
              onSave={() => form.handleSubmit(onSubmit)()}
              onCancel={onCancel}
              isSaving={isSaving}
              isDirty={isDirty}
              isValid={form.formState.isValid}
              saveLabel="Save Contact Info"
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
