"use client"

import { PublicOrgPageShell } from "@/components/site/public-org-page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"
import { Database, Eye, Globe, Lock, Shield, Users } from "lucide-react"

function PlaceholderPrivacy({ organizationName }: { organizationName: string }) {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-blue-500" />
            Introduction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            {organizationName} is committed to protecting privacy and handling data responsibly.
            This Privacy Policy describes how personal information and other data may be collected,
            used, disclosed, and safeguarded when you use this platform and related services.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            This document is a general placeholder for the multi-tenant framework. Each
            organization may replace or extend it with its own privacy policy in organization
            settings to match its business, jurisdiction, and data practices.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-green-500" />
            Information We Collect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="mb-2 font-semibold dark:text-white">Account and contact data</h3>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>Name, email address, and other contact details you provide</li>
              <li>Profile information and preferences</li>
              <li>Billing or payment details when payments are used</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-semibold dark:text-white">Business and usage data</h3>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>Content, records, and other data you or your organization store in the Service</li>
              <li>Activity and interaction data needed to operate and secure the platform</li>
              <li>Device, browser, and technical logs</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" />
            How We Use Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">Information may be used to:</p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Provide, maintain, and support the Service</li>
            <li>Authenticate users and manage accounts</li>
            <li>Process transactions and send operational communications</li>
            <li>Improve reliability, security, and features</li>
            <li>Comply with legal obligations and enforce applicable terms</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-orange-500" />
            Sharing and Disclosure
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Personal information is not sold. It may be shared only as needed, for example with:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong>Service providers</strong> who help operate infrastructure, email, payments, or
              similar functions
            </li>
            <li>
              <strong>Legal authorities</strong> when required by law or to protect rights and safety
            </li>
            <li>
              <strong>Business transfers</strong> if the organization or Service is involved in a
              merger, acquisition, or similar event
            </li>
            <li>
              <strong>Others</strong> with your consent or as directed by your organization
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-red-500" />
            Data Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Reasonable technical and organizational measures are used to protect data against
            unauthorized access, alteration, disclosure, or destruction. No method of transmission or
            storage is completely secure; please use strong credentials and report suspected
            incidents promptly.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            Your Rights and Choices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Depending on applicable law and your organization&apos;s policies, you may have rights to
            access, correct, delete, or export personal information, or to object to or restrict
            certain processing. Contact your organization to exercise these rights.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cookies and Similar Technologies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="leading-relaxed text-muted-foreground">
            Cookies and similar technologies may be used to keep you signed in, remember
            preferences, and support security and performance. You can control cookies through your
            browser; disabling some cookies may affect how the Service works.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Changes to This Policy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-muted-foreground">
            This Privacy Policy may be updated from time to time. Changes will be posted on this
            page with an updated &quot;Last updated&quot; date. If your organization publishes a custom
            policy, that version controls for users of that organization.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function PrivacyPolicyPage() {
  const { name, privacyNotice } = useOrgWhiteLabelData()
  const organizationName = name?.trim() || "This organization"
  const customPrivacy = privacyNotice?.trim()

  return (
    <PublicOrgPageShell>
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <Shield className="h-16 w-16 text-blue-500" />
        </div>
        <h1 className="mb-4 text-4xl font-bold dark:text-white">Privacy Policy</h1>
        <p className="text-lg text-muted-foreground">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </div>

      {customPrivacy ? (
        <Card>
          <CardContent className="pt-6">
            <div className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {customPrivacy}
            </div>
          </CardContent>
        </Card>
      ) : (
        <PlaceholderPrivacy organizationName={organizationName} />
      )}
    </PublicOrgPageShell>
  )
}
