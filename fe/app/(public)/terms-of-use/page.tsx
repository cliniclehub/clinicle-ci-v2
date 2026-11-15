"use client"

import { PublicOrgPageShell } from "@/components/site/public-org-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { AlertTriangle, FileText, Shield } from "lucide-react"
import Link from "next/link"

function PlaceholderTerms({ organizationName }: { organizationName: string }) {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>1. Acceptance of Terms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            By accessing or using this platform and related services (the &quot;Service&quot;) operated by{" "}
            {organizationName}, you agree to these Terms of Use. If you do not agree, do not use the
            Service.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            These Terms are a general placeholder for the multi-tenant framework. Each organization
            may replace or extend them with its own terms in organization settings.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Description of Service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            The Service provides organization-branded software for managing accounts, content, and
            related business data. Features available to you depend on how your organization
            configures and uses the platform.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Where an account is required, you agree to provide accurate information, keep your
            credentials secure, and accept responsibility for activity under your account. Notify
            your organization promptly if you suspect unauthorized access.
          </p>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Important:</strong> You are responsible for maintaining the confidentiality
                of your account credentials.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Acceptable Use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            You may use the Service only for lawful purposes and in ways that do not harm the
            platform, other users, or the organization. Prohibited uses include violating
            applicable law, infringing intellectual property, harassing others, uploading malware,
            attempting unauthorized access, or interfering with Service operation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5. Content and Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            You retain rights in content and data you submit, subject to any agreement with your
            organization. By submitting content or data, you grant the organization and its service
            providers a license to host, process, and display it as needed to operate the Service.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Platform software, branding, and related materials remain the property of their
            respective owners and are protected by applicable intellectual property laws.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            6. Privacy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-muted-foreground">
            How personal and other data is handled is described in the{" "}
            <Link
              href="/privacy-policy"
              className="text-blue-500 underline hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Privacy Policy
            </Link>
            , which is incorporated into these Terms by reference.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>7. Termination</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Access may be suspended or terminated if these Terms are violated or if continued use
            would harm the organization, other users, or the Service. You may stop using the Service
            at any time. Account and data handling after termination follows the organization&apos;s
            policies and applicable law.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>8. Disclaimers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, to
            the extent permitted by law. The organization and platform operators are not liable for
            indirect, incidental, special, consequential, or punitive damages arising from use of
            the Service, except where liability cannot be limited by law.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>9. Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-muted-foreground">
            These Terms may be updated from time to time. Material changes will be reflected on this
            page and by updating the &quot;Last updated&quot; date. Continued use after changes constitutes
            acceptance of the updated Terms, unless your organization publishes different terms.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function TermsOfUsePage() {
  const { name, termsOfUse } = useOrgWhiteLabelData()
  const organizationName = name?.trim() || "this organization"
  const customTerms = termsOfUse?.trim()

  return (
    <PublicOrgPageShell>
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <FileText className="h-16 w-16 text-blue-500" />
        </div>
        <h1 className="mb-4 text-4xl font-bold dark:text-white">Terms of Use</h1>
        <p className="text-lg text-muted-foreground">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </div>

      {customTerms ? (
        <Card>
          <CardContent className="pt-6">
            <div className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {customTerms}
            </div>
          </CardContent>
        </Card>
      ) : (
        <PlaceholderTerms organizationName={organizationName} />
      )}
    </PublicOrgPageShell>
  )
}
