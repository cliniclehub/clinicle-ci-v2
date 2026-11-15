"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useState } from "react"
import { toast } from "sonner"

export function EmailServiceSettings() {
  const [provider, setProvider] = useState("sendgrid")
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async () => {
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setIsLoading(false)
    toast.success("Email service settings have been updated successfully.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Service Configuration</CardTitle>
        <CardDescription>
          Configure the email service provider used for sending system emails, notifications, and user communications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="provider">Email Service Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sendgrid">SendGrid</SelectItem>
              <SelectItem value="mailchimp">Mailchimp</SelectItem>
              <SelectItem value="ses">Amazon SES</SelectItem>
              <SelectItem value="mailgun">Mailgun</SelectItem>
              <SelectItem value="smtp">Custom SMTP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs value={provider} className="mt-6">
          <TabsContent value="sendgrid" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sendgrid-api-key">SendGrid API Key</Label>
              <Input id="sendgrid-api-key" type="password" placeholder="Enter your SendGrid API key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sendgrid-from-email">From Email</Label>
              <Input id="sendgrid-from-email" type="email" placeholder="noreply@yourdomain.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sendgrid-from-name">From Name</Label>
              <Input id="sendgrid-from-name" placeholder="Your Organization Name" />
            </div>
          </TabsContent>

          <TabsContent value="mailchimp" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mailchimp-api-key">Mailchimp API Key</Label>
              <Input id="mailchimp-api-key" type="password" placeholder="Enter your Mailchimp API key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mailchimp-server-prefix">Server Prefix</Label>
              <Input id="mailchimp-server-prefix" placeholder="us1" />
            </div>
          </TabsContent>

          <TabsContent value="ses" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ses-access-key">AWS Access Key</Label>
              <Input id="ses-access-key" placeholder="Enter your AWS access key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ses-secret-key">AWS Secret Key</Label>
              <Input id="ses-secret-key" type="password" placeholder="Enter your AWS secret key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ses-region">AWS Region</Label>
              <Input id="ses-region" placeholder="us-east-1" />
            </div>
          </TabsContent>

          <TabsContent value="mailgun" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mailgun-api-key">Mailgun API Key</Label>
              <Input id="mailgun-api-key" type="password" placeholder="Enter your Mailgun API key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mailgun-domain">Mailgun Domain</Label>
              <Input id="mailgun-domain" placeholder="mg.yourdomain.com" />
            </div>
          </TabsContent>

          <TabsContent value="smtp" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">SMTP Host</Label>
              <Input id="smtp-host" placeholder="smtp.yourdomain.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">SMTP Port</Label>
              <Input id="smtp-port" placeholder="587" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-username">SMTP Username</Label>
              <Input id="smtp-username" placeholder="Enter your SMTP username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">SMTP Password</Label>
              <Input id="smtp-password" type="password" placeholder="Enter your SMTP password" />
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="smtp-secure" />
              <Label htmlFor="smtp-secure">Use SSL/TLS</Label>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t">
          <div className="space-y-2">
            <Label>Email Templates</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button variant="outline" className="justify-start">
                Welcome Email
              </Button>
              <Button variant="outline" className="justify-start">
                Password Reset
              </Button>
              <Button variant="outline" className="justify-start">
                Account Verification
              </Button>
              <Button variant="outline" className="justify-start">
                Account Welcome
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch id="email-sandbox" />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="email-sandbox">Sandbox Mode</Label>
              <p className="text-sm text-muted-foreground">When enabled, emails will not be sent to real recipients.</p>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={isLoading}>
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  )
}
