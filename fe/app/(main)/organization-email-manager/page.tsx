"use client"

import { EmailLogsList } from "@/components/email-engine/email-logs-list"
import { EmailQueueList } from "@/components/email-engine/email-queue-list"
import { TemplatesList } from "@/components/email-engine/templates-list"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileText, Mail, Send } from "lucide-react"
import { useState } from "react"

export default function EmailTemplatesPage() {
  const [activeTab, setActiveTab] = useState("templates")

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Email Management</h1>
        <p className="text-muted-foreground mt-2">
          Manage email templates, monitor queue status, and track delivery analytics
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            <Send className="h-4 w-4" />
            Queue
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <Mail className="h-4 w-4" />
            Logs & Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Templates</CardTitle>
              <CardDescription>
                Create and manage email templates with dynamic fields for transactional and bulk emails
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplatesList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Queue</CardTitle>
              <CardDescription>
                Monitor pending, processing, and sent emails with retry status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmailQueueList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Logs & Analytics</CardTitle>
              <CardDescription>
                Track email delivery, opens, clicks, and bounces
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmailLogsList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
