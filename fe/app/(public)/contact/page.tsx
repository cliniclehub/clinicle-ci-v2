"use client"

import { PublicOrgPageShell } from "@/components/site/public-org-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { submitPublicContactForm } from "@/lib/actions/organizations/organizations-org-actions"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { cn } from "@/lib/utils/cn"
import { createClientLogger } from "@/lib/utils/logger-client"
import { emailAddressSchema } from "@/lib/utils/email-validation"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { DefaultValues } from "react-hook-form"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

const logger = createClientLogger("ContactPage")

const DEFAULT_CONTACT_TOPICS = [
  { key: "general", label: "General" },
  { key: "technical", label: "Technical issue" },
  { key: "billing", label: "Billing" },
  { key: "account", label: "Account" },
  { key: "other", label: "Other" },
]

const buildContactFormSchema = (allowedTopicKeys: string[]) => z.object({
  name: z.string().min(1, "Name is required"),
  email: emailAddressSchema,
  category: z
    .string()
    .min(1, "Please choose a topic")
    .refine((value) => allowedTopicKeys.includes(value), "Please choose a valid topic"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(10, "Please add a bit more detail (at least 10 characters)"),
})
type ContactFormData = {
  name: string
  email: string
  category: string
  subject: string
  message: string
}

export default function ContactPage() {
  const { user, isLoading: authLoading } = useAuth()
  const {
    org,
    name: orgName,
    supportEmail,
  } = useOrgWhiteLabelData()
  const [isSaving, setIsSaving] = useState(false)

  const topicOptions = useMemo(() => {
    const configuredTopics = org?.siteTheme?.contactTopics
    if (!Array.isArray(configuredTopics) || configuredTopics.length === 0) {
      return DEFAULT_CONTACT_TOPICS
    }
    const normalized = configuredTopics
      .map((topic) => ({
        key: typeof topic?.key === "string" ? topic.key.trim().toLowerCase() : "",
        label: typeof topic?.label === "string" ? topic.label.trim() : "",
      }))
      .filter((topic) => topic.key && topic.label)
    return normalized.length > 0 ? normalized : DEFAULT_CONTACT_TOPICS
  }, [org?.siteTheme?.contactTopics])

  const defaultValues = useMemo(
    (): DefaultValues<ContactFormData> => ({
      name: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
      email: user?.email ?? "",
      category: topicOptions[0]?.key ?? "general",
      subject: "",
      message: "",
    }),
    [topicOptions, user?.email, user?.firstName, user?.lastName]
  )

  const contactFormSchema = useMemo(
    () => buildContactFormSchema(topicOptions.map((topic) => topic.key)),
    [topicOptions]
  )

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const organizationName = orgName || "Learning portal"
  const trimmedSupport = supportEmail?.trim() ?? ""
  const isIdentityReadOnly = !authLoading && Boolean(user)

  const onSubmit = async (data: ContactFormData) => {
    if (!trimmedSupport) {
      toast.error(
        "This organization has not set a support email yet. Please reach out through your administrator."
      )
      return
    }

    setIsSaving(true)
    try {
      const response = await submitPublicContactForm({
        name: data.name.trim(),
        email: data.email.trim(),
        category: data.category,
        subject: data.subject.trim(),
        message: data.message.trim(),
      })
      if (response.status === "success") {
        toast.success(response.message || "Your message has been sent.")
        form.reset({
          ...defaultValues,
          subject: "",
          message: "",
        })
      } else {
        toast.error(response.message || "Could not send your message. Please try again.")
      }
    } catch (e) {
      logger.error("Contact form submission failed", e as Error, { orgName: organizationName })
      toast.error("Could not send your message. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <PublicOrgPageShell>
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">Contact us</h1>
      <p className="mb-8 text-muted-foreground">
        Use the form below to reach {organizationName} support team.
      </p>

      <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
            
          </CardHeader>
          <CardContent>
            {trimmedSupport ? (
              <div className="mb-8 space-y-4 rounded-lg border border-border bg-muted/40 p-4">
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contact-dest-inbox" className="text-muted-foreground">
                      Support inbox: {trimmedSupport}
                    </Label>
                    
                  </div>
                </div>
              </div>
            ) : (
              <p className="mb-8 text-sm text-muted-foreground rounded-lg border border-border bg-muted/40 p-4">
                This organization has not configured a support email. An administrator can add one under
                Organization settings → Contact.
              </p>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your name</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="name"
                            placeholder="Your name"
                            readOnly={isIdentityReadOnly}
                            aria-readonly={isIdentityReadOnly ? true : undefined}
                            className={cn(
                              isIdentityReadOnly && "bg-muted text-muted-foreground cursor-default"
                            )}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            readOnly={isIdentityReadOnly}
                            aria-readonly={isIdentityReadOnly ? true : undefined}
                            className={cn(
                              isIdentityReadOnly && "bg-muted text-muted-foreground cursor-default"
                            )}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Topic</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a topic (required)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {topicOptions.map((topic) => (
                            <SelectItem key={topic.key} value={topic.key}>
                              {topic.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      <FormControl>
                        <Input placeholder="Brief summary" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Message</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe your question or issue…"
                          className="min-h-[140px] resize-y"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full sm:w-auto" disabled={isSaving || !trimmedSupport}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send message"
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="mt-8 text-sm text-muted-foreground">
          We usually reply within a few business days. For password resets, use{" "}
          <Link href="/forgot-password" className="text-foreground underline underline-offset-2">
            Forgot password
        </Link>
        .
      </p>
    </PublicOrgPageShell>
  )
}
