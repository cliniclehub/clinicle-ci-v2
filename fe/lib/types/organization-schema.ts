import { z } from "zod"

export type OrgDomainKind = "platform" | "custom"

export const organizationBasicInfoObjectSchema = z.object({
  name: z.string().trim().min(1, "Organization name is required").max(255),
  domainKind: z.enum(["platform", "custom"]),
  domain: z.string().trim().min(1, "Domain is required").max(255),
  code: z.string().max(64).optional().or(z.literal("")),
  orgType: z.enum(["Company", "Nonprofit", "Education", "Other"]).optional(),
  isActive: z.boolean(),
  timezone: z.string().min(1, "Timezone is required").max(64).default("UTC"),
})

function refineOrgDomainFields(
  data: { domainKind: OrgDomainKind; domain: string },
  ctx: z.RefinementCtx
) {
  const value = data.domain.trim()
  if (data.domainKind === "platform") {
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domain"], message: "Enter a valid hostname" })
    }
    return
  }
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/i.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domain"], message: "Enter a full domain" })
  }
}

export const organizationBasicInfoSchema = organizationBasicInfoObjectSchema.superRefine(refineOrgDomainFields)

export const organizationLandingPageSchema = z.object({
  landingPageHtml: z.string().optional(),
})

const optionalMediaUrl = z.string().refine(
  (value) => value === "" || value.startsWith("/api/local-media/") || z.string().url().safeParse(value).success,
  { message: "Invalid media URL" }
).optional().or(z.literal(""))

export const organizationBrandingSchema = z.object({
  logoUrl: optionalMediaUrl,
  faviconUrl: optionalMediaUrl,
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  landingPageHtml: z.string().optional(),
  siteTheme: z.object({
    contactTopics: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
    colors: z.object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
    }).optional(),
    typography: z.object({ fontFamily: z.string().optional() }).optional(),
  }).optional(),
})

export const organizationLegalSchema = z.object({
  termsOfUse: z.string().optional(),
  privacyPolicy: z.string().optional(),
})

export const organizationContactSchema = z.object({
  supportEmail: z.string().email("Invalid email format").optional().or(z.literal("")),
  infoEmail: z.string().email("Invalid email format").optional().or(z.literal("")),
  adminEmail: z.string().email("Invalid email format").optional().or(z.literal("")),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(128).optional(),
  stateProvince: z.string().max(128).optional(),
  zipPostal: z.string().max(32).optional(),
  country: z.string().max(128).optional(),
})

export const organizationTrackingSchema = z.object({
  trackingScripts: z.object({
    enabled: z.boolean().default(false),
    gtmContainerId: z.string().regex(/^GTM-[A-Z0-9]{6,10}$/, "Must match GTM-XXXXXXX").optional().or(z.literal("")),
    customHeadScripts: z.string().max(5000).optional().or(z.literal("")),
    customBodyScripts: z.string().max(5000).optional().or(z.literal("")),
  }).optional(),
})

export const organizationFormSchema = z.object({
  ...organizationBasicInfoObjectSchema.shape,
  ...organizationBrandingSchema.shape,
  ...organizationLegalSchema.shape,
  ...organizationContactSchema.shape,
}).superRefine(refineOrgDomainFields)

export type OrganizationBasicInfo = z.infer<typeof organizationBasicInfoSchema>
export type OrganizationBranding = z.infer<typeof organizationBrandingSchema>
export type OrganizationLandingPage = z.infer<typeof organizationLandingPageSchema>
export type OrganizationLegal = z.infer<typeof organizationLegalSchema>
export type OrganizationContact = z.infer<typeof organizationContactSchema>
export type OrganizationTracking = z.infer<typeof organizationTrackingSchema>
export type OrganizationForm = z.infer<typeof organizationFormSchema>

export interface OrganizationSiteTheme {
  contactTopics?: Array<{ key: string; label: string }>
  colors?: { primary?: string; secondary?: string; accent?: string }
  typography?: { fontFamily?: string }
  [key: string]: unknown
}

export interface TrackingScripts {
  enabled?: boolean
  gtmContainerId?: string
  customHeadScripts?: string
  customBodyScripts?: string
}

export interface Organization {
  id: string
  name: string
  domain: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  userCount?: number
  code?: string
  orgType?: string
  logoUrl?: string
  faviconUrl?: string
  termsOfUse?: string
  privacyPolicy?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  stateProvince?: string
  zipPostal?: string
  country?: string
  supportEmail?: string
  infoEmail?: string
  adminEmail?: string
  landingPageHtml?: string
  siteTheme?: OrganizationSiteTheme
  trackingScripts?: TrackingScripts
  notificationSettings?: Record<string, unknown>
  enforcePhoneValidation?: boolean
  timezone?: string
  primaryColor?: string
  secondaryColor?: string
}

export type OrganizationUpdatePayload = Partial<Omit<Organization, "id" | "createdAt" | "updatedAt" | "userCount">>

export interface OrganizationPublic {
  name: string
  domain: string
  logoUrl?: string
  faviconUrl?: string
  termsOfUse?: string
  privacyPolicy?: string
  siteTheme?: OrganizationSiteTheme
  trackingScripts?: TrackingScripts
  adminEmail?: string
  supportEmail?: string
  enforcePhoneValidation?: boolean
}

export interface OrganizationLandingPagePublic { landingPageHtml?: string | null }

export enum OrgTypeEnum {
  Company = "Company",
  Nonprofit = "Nonprofit",
  Education = "Education",
  Other = "Other",
}

export interface FormattedOrganization extends Partial<OrganizationPublic> {
  landingPageHtml?: string
  primaryColor?: string
  secondaryColor?: string
  infoEmail?: string
  country?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface OrganizationDropdown {
  id: string
  name: string
  domain: string
}
