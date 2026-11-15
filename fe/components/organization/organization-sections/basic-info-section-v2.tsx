"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { CheckCircle2, Copy, ExternalLink, Loader2, XCircle } from "lucide-react"

import { updateMyOrganizationBasicInfo } from "@/lib/actions/organizations/organizations-org-actions"
import {
  addDomainToRender,
  createOrganization as createOrganizationPlatform,
  updateOrganizationBasicInfo as updateOrganizationBasicInfoPlatform,
  verifyDomainDNS,
  type DomainVerificationResult,
} from "@/lib/actions/organizations/organizations-platform-actions"
import { ORG_IANA_TIMEZONES } from "@/lib/constants/iana-timezones"
import { Organization, OrganizationBasicInfo, organizationBasicInfoSchema } from "@/lib/types/organization-schema"
import { createClientLogger } from "@/lib/utils/logger-client"
import {
  buildPlatformDomain,
  extractPlatformHostname,
  getCustomDomainParentZone,
  getCustomDomainSubdomainLabel,
  inferOrgDomainKind,
  isLocalPlatformEnv,
  normalizeDnsHostname,
  resolvePlatformCnameTarget,
  resolvePlatformBaseDomain,
  type OrgDomainKind,
} from "@/lib/utils/org-platform-domain"

interface BasicInfoSectionProps {
  organization?: Organization
  mode: "create" | "edit"
  isOrgAdmin?: boolean
  isSuperAdmin?: boolean
  onDirtyChange: (isDirty: boolean) => void
  onCancel: () => void
  onSuccess?: (organization: Organization) => void
}

function buildFormDefaults(organization?: Organization): OrganizationBasicInfo {
  const kind = inferOrgDomainKind(organization?.domain)
  const sourceHost = organization?.domain || ""

  return {
    name: organization?.name || "",
    domainKind: kind,
    domain:
      kind === "platform" ? extractPlatformHostname(sourceHost) : normalizeDnsHostname(sourceHost),
    code: organization?.code || "",
    orgType:
      (organization?.orgType as
        | "Company"
        | "Nonprofit"
        | "Education"
        | "Other") || undefined,
    isActive: organization?.isActive ?? true,
    timezone: organization?.timezone || "UTC",
  }
}

export function BasicInfoSection({
  organization,
  mode,
  isOrgAdmin = false,
  isSuperAdmin = false,
  onDirtyChange,
  onCancel,
  onSuccess,
}: BasicInfoSectionProps) {
  const logger = createClientLogger("BasicInfoSection")
  const [isSaving, setIsSaving] = useState(false)
  const [showDirtyDialog, setShowDirtyDialog] = useState(false)
  const [addingRenderDomain, setAddingRenderDomain] = useState<string | null>(null)
  const [orgDomainDnsResult, setOrgDomainDnsResult] = useState<DomainVerificationResult | null>(null)
  const [verifyingOrgDomain, setVerifyingOrgDomain] = useState<string | null>(null)

  const cnameTarget = useMemo(() => resolvePlatformCnameTarget(), [])
  const platformBaseDomain = useMemo(() => resolvePlatformBaseDomain(), [])
  const platformSuffix = `.${platformBaseDomain}`
  const localPlatformEditable = isLocalPlatformEnv()

  const form = useForm<OrganizationBasicInfo>({
    resolver: zodResolver(organizationBasicInfoSchema),
    defaultValues: buildFormDefaults(organization),
    mode: "onChange",
  })

  const {
    formState: { isDirty },
    watch,
    setValue,
  } = form
  const canSave = true
  const watchedDomain = watch("domain")
  const watchedDomainKind = watch("domainKind")

  const resolvedPreviewHost = useMemo(() => {
    if (!watchedDomain?.trim()) return ""
    return watchedDomainKind === "platform"
      ? buildPlatformDomain(watchedDomain)
      : normalizeDnsHostname(watchedDomain)
  }, [watchedDomain, watchedDomainKind])

  useEffect(() => {
    const host = normalizeDnsHostname(resolvedPreviewHost || "")
    if (orgDomainDnsResult && normalizeDnsHostname(orgDomainDnsResult.domain) !== host) {
      setOrgDomainDnsResult(null)
    }
  }, [resolvedPreviewHost, orgDomainDnsResult])

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (organization && mode === "edit") {
      form.reset(buildFormDefaults(organization), { keepDirty: false })
    }
  }, [organization, mode])

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

  const handleDomainKindChange = (nextKind: OrgDomainKind) => {
    const current = watchedDomain || ""
    if (nextKind === "platform") {
      const host = extractPlatformHostname(
        current.includes(".") ? current : buildPlatformDomain(current)
      )
      setValue("domainKind", "platform", { shouldDirty: true })
      setValue("domain", host, { shouldDirty: true, shouldValidate: true })
      return
    }
    setValue("domainKind", "custom", { shouldDirty: true })
    setValue(
      "domain",
      current.includes(".") ? normalizeDnsHostname(current) : buildPlatformDomain(current),
      { shouldDirty: true, shouldValidate: true }
    )
  }

  const handleVerifyOrgDomainDns = async (domain: string) => {
    const host = normalizeDnsHostname(domain)
    if (!host) {
      toast.error("Please enter a domain first")
      return
    }
    setVerifyingOrgDomain(host)
    try {
      const response = await verifyDomainDNS(host, "organization")
      if (response.status === "success" && response.data) {
        setOrgDomainDnsResult(response.data)
        if (response.data.verified) {
          toast.success(response.data.message || "DNS looks correct")
        } else {
          toast.info(response.data.message || "DNS not verified yet — you can still save and use Render")
        }
      } else {
        toast.error(response.message || "Failed to verify DNS")
      }
    } catch (error) {
      logger.error("Verify organization domain DNS failed", error as Error, { host })
      toast.error("Could not verify DNS right now")
    } finally {
      setVerifyingOrgDomain(null)
    }
  }

  const handleAddDomainToRender = async (domain: string) => {
    const fullDomain = normalizeDnsHostname(domain)
    if (!fullDomain) {
      toast.error("Please enter a domain first")
      return
    }

    try {
      setAddingRenderDomain(fullDomain)
      const response = await addDomainToRender(fullDomain)
      if (response.status === "success") {
        toast.success(`Domain ${fullDomain} added to Render`)
      } else {
        toast.error(response.message || `Failed to add ${fullDomain} to Render`)
      }
    } catch {
      toast.error(`Failed to add ${fullDomain} to Render`)
    } finally {
      setAddingRenderDomain(null)
    }
  }

  const onSubmit = async (data: OrganizationBasicInfo) => {
    setIsSaving(true)

    try {
      const fullDomain =
        data.domainKind === "platform"
          ? buildPlatformDomain(data.domain)
          : normalizeDnsHostname(data.domain)

      const submitData = {
        name: data.name,
        domain: fullDomain,
        code: data.code,
        orgType: data.orgType,
        isActive: data.isActive,
        timezone: data.timezone,
      }

      if (mode === "create") {
        const response = await createOrganizationPlatform({ ...submitData, domainKind: data.domainKind })

        if (response.status === "success" && response.data) {
          toast.success("Organization created successfully")
          onSuccess?.(response.data)
        } else {
          toast.error(response.message || "Failed to create organization")
        }
      } else if (organization) {
        const response = isOrgAdmin
          ? await updateMyOrganizationBasicInfo(submitData)
          : await updateOrganizationBasicInfoPlatform(organization.id, submitData)

        if (response.status === "success") {
          toast.success("Basic information saved successfully")
          const updatedOrg = response.data || {
            ...organization,
            ...submitData,
          }
          form.reset(buildFormDefaults(updatedOrg))
          onSuccess?.(updatedOrg)
        } else {
          toast.error(response.message || "Failed to save basic information")
        }
      }
    } catch {
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
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Core organization details and configuration</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter organization name" />
                    </FormControl>
                    <FormDescription>The display name for this organization</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="ORG001" />
                    </FormControl>
                    <FormDescription>Short code for internal reference</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orgType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select organization type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Company">Company</SelectItem>
                        <SelectItem value="Nonprofit">Nonprofit</SelectItem>
                        <SelectItem value="Education">Education</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>The type of organization</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select timezone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-72">
                        {ORG_IANA_TIMEZONES.map((z) => (
                          <SelectItem key={z.value} value={z.value}>
                            {z.label} ({z.value})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Used for notifications and other scheduled activity. Administrators pick
                      calendar days in this timezone;
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Active Status</FormLabel>
                      <FormDescription>
                        {isOrgAdmin
                          ? "Organization status can only be changed by platform administrators"
                          : "Enable or disable this organization"}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isOrgAdmin}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Site URL</CardTitle>
              <CardDescription className="text-sm">
                Choose a platform hostname under the current environment, or a custom domain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="domainKind"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Domain type</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={(value) => handleDomainKindChange(value as OrgDomainKind)}
                        className="flex flex-col gap-3 sm:flex-row sm:gap-6"
                        disabled={isOrgAdmin}
                      >
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <RadioGroupItem value="platform" id="domain-kind-platform" />
                          Platform domain
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <RadioGroupItem value="custom" id="domain-kind-custom" />
                          Custom domain
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="domain"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {watchedDomainKind === "platform"
                        ? "Platform hostname"
                        : "Custom domain"}
                    </FormLabel>
                    <div className="flex gap-2 items-center w-full">
                      {watchedDomainKind === "platform" && !localPlatformEditable ? (
                        <div className="flex items-center gap-0 border rounded-md flex-1 min-w-0">
                          <FormControl>
                            <Input
                              {...field}
                              value={extractPlatformHostname(field.value || "")}
                              onChange={(e) => {
                                field.onChange(extractPlatformHostname(e.target.value))
                              }}
                              placeholder="yourorganization"
                              className="font-mono border-0 rounded-r-none"
                              disabled={isOrgAdmin}
                            />
                          </FormControl>
                          <span className="px-3 py-2 bg-muted text-muted-foreground font-mono text-sm border-l whitespace-nowrap">
                            {platformSuffix}
                          </span>
                        </div>
                      ) : (
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={
                              watchedDomainKind === "platform"
                                ? `yourorganization${platformSuffix}`
                                : "learn.yourorganization.com"
                            }
                            className="font-mono"
                            disabled={isOrgAdmin}
                          />
                        </FormControl>
                      )}

                      {resolvedPreviewHost && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(
                              `https://${resolvedPreviewHost}`,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                          className="shrink-0"
                          title={`Open https://${resolvedPreviewHost} in new tab`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {watchedDomainKind === "platform" && (
                      <FormDescription>
                        Saved as{" "}
                        <code className="font-mono text-xs">
                          {resolvedPreviewHost || `hostname${platformSuffix}`}
                        </code>
                        . No Namecheap or Render steps are required for platform hosts.
                      </FormDescription>
                    )}

                    {watchedDomainKind === "custom" && isSuperAdmin && resolvedPreviewHost && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleVerifyOrgDomainDns(resolvedPreviewHost)}
                          disabled={verifyingOrgDomain === resolvedPreviewHost}
                          className="shrink-0"
                        >
                          {verifyingOrgDomain === resolvedPreviewHost ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Verifying...
                            </>
                          ) : (
                            "Verify DNS"
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddDomainToRender(resolvedPreviewHost)}
                          disabled={addingRenderDomain === resolvedPreviewHost}
                          className="shrink-0"
                        >
                          {addingRenderDomain === resolvedPreviewHost ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Adding...
                            </>
                          ) : (
                            "Add to Render"
                          )}
                        </Button>
                      </div>
                    )}

                    {watchedDomainKind === "custom" && isSuperAdmin && resolvedPreviewHost && (
                      <div className="bg-muted p-3 rounded-md space-y-2 mt-2">
                        <p className="text-sm font-medium">DNS Configuration Steps:</p>
                        <div className="text-xs text-muted-foreground bg-background border rounded p-2 space-y-1">
                          <p>1) Enter the domain name and click &quot;Save Changes&quot; below.</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span>
                              2) In your DNS provider (
                              <code className="bg-muted px-1 rounded font-mono">
                                {getCustomDomainParentZone(resolvedPreviewHost)}
                              </code>
                              ), add CNAME:
                            </span>
                            <span className="font-medium text-foreground">Host:</span>
                            <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                              {getCustomDomainSubdomainLabel(resolvedPreviewHost)}
                            </code>
                            <span className="text-muted-foreground">→</span>
                            <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                              {cnameTarget}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5"
                              onClick={() => {
                                navigator.clipboard.writeText(cnameTarget)
                                toast.success("Copied to clipboard")
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                          <p>
                            3) Optional: click{" "}
                            <strong className="text-foreground">Verify DNS</strong> (informational
                            only). DNS changes can take 5–30 minutes.
                          </p>
                          <p>
                            4) Add this hostname in Render using{" "}
                            <strong className="text-foreground">Add to Render</strong>.
                          </p>
                        </div>
                        {orgDomainDnsResult &&
                          normalizeDnsHostname(orgDomainDnsResult.domain) ===
                            normalizeDnsHostname(resolvedPreviewHost) && (
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {orgDomainDnsResult.verified ? (
                                <CheckCircle2
                                  className="h-4 w-4 text-primary shrink-0"
                                  aria-hidden
                                />
                              ) : (
                                <XCircle
                                  className="h-4 w-4 text-destructive shrink-0"
                                  aria-hidden
                                />
                              )}
                              <Badge
                                variant={orgDomainDnsResult.verified ? "default" : "destructive"}
                              >
                                {orgDomainDnsResult.verified ? "Verified" : "Not verified"}
                              </Badge>
                              <span className="text-muted-foreground">
                                {orgDomainDnsResult.message}
                              </span>
                            </div>
                          )}
                      </div>
                    )}

                    {isOrgAdmin && (
                      <FormDescription>
                        This URL can only be changed by platform administrators.
                      </FormDescription>
                    )}
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
            isValid={canSave}
            saveLabel={mode === "create" ? "Create Organization" : "Save Changes"}
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
