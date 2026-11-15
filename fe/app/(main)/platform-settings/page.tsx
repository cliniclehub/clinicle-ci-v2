"use client"

import { EmailServiceSettings } from "@/components/platform-settings/email-service-settings"
import { SecuritySettings } from "@/components/platform-settings/security-settings"
import { SmsServiceSettings } from "@/components/platform-settings/sms-service-settings"
import { StorageServiceSettings } from "@/components/platform-settings/storage-service-settings"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRoles } from "@/lib/contexts/role-context"
import { getDefaultLandingPage } from "@/lib/utils/navigation-helper"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function PlatformSettingsPage() {
  const { activeRole } = useRoles()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("email")

  useEffect(() => {
    if (activeRole !== "super_admin") {
      router.push(getDefaultLandingPage(activeRole))
    }
  }, [activeRole, router])

  if (activeRole !== "super_admin") {
    return null
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
          <Badge variant="secondary">Mockup</Badge>
        </div>
        <p className="text-muted-foreground">
          Configure platform-wide services and integrations for all organizations.
          This screen is a mockup and does not persist real configuration yet.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="space-y-4">
          <EmailServiceSettings />
        </TabsContent>

        <TabsContent value="sms" className="space-y-4">
          <SmsServiceSettings />
        </TabsContent>

        <TabsContent value="storage" className="space-y-4">
          <StorageServiceSettings />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}
