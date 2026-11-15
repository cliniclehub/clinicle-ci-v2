"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { toast } from "sonner"
import { useState } from "react"

export function SmsServiceSettings() {
  const [provider, setProvider] = useState("twilio")
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async () => {
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setIsLoading(false)
    toast.success("SMS service settings have been updated successfully.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS Notification Service</CardTitle>
        <CardDescription>
          Configure the SMS service provider used for sending text notifications to users.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="sms-provider">SMS Service Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger id="sms-provider">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twilio">Twilio</SelectItem>
              <SelectItem value="vonage">Vonage (Nexmo)</SelectItem>
              <SelectItem value="aws-sns">AWS SNS</SelectItem>
              <SelectItem value="messagebird">MessageBird</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs value={provider} className="mt-6">
          <TabsContent value="twilio" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="twilio-account-sid">Account SID</Label>
              <Input id="twilio-account-sid" placeholder="Enter your Twilio Account SID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twilio-auth-token">Auth Token</Label>
              <Input id="twilio-auth-token" type="password" placeholder="Enter your Twilio Auth Token" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twilio-phone-number">Twilio Phone Number</Label>
              <Input id="twilio-phone-number" placeholder="+1234567890" />
            </div>
          </TabsContent>

          <TabsContent value="vonage" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vonage-api-key">API Key</Label>
              <Input id="vonage-api-key" placeholder="Enter your Vonage API Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vonage-api-secret">API Secret</Label>
              <Input id="vonage-api-secret" type="password" placeholder="Enter your Vonage API Secret" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vonage-from">From Number/Name</Label>
              <Input id="vonage-from" placeholder="Your Brand Name or Number" />
            </div>
          </TabsContent>

          <TabsContent value="aws-sns" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aws-access-key">AWS Access Key</Label>
              <Input id="aws-access-key" placeholder="Enter your AWS Access Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-secret-key">AWS Secret Key</Label>
              <Input id="aws-secret-key" type="password" placeholder="Enter your AWS Secret Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aws-region">AWS Region</Label>
              <Input id="aws-region" placeholder="us-east-1" />
            </div>
          </TabsContent>

          <TabsContent value="messagebird" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="messagebird-api-key">API Key</Label>
              <Input id="messagebird-api-key" type="password" placeholder="Enter your MessageBird API Key" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="messagebird-originator">Originator</Label>
              <Input id="messagebird-originator" placeholder="Your Brand Name or Number" />
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-4 pt-4 border-t">
          <div className="space-y-2">
            <Label>SMS Templates</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button variant="outline" className="justify-start">
                Verification Code
              </Button>
              <Button variant="outline" className="justify-start">
                Class Reminder
              </Button>
              <Button variant="outline" className="justify-start">
                Assignment Due
              </Button>
              <Button variant="outline" className="justify-start">
                Password Reset
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch id="sms-sandbox" />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="sms-sandbox">Test Mode</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, SMS messages will not be sent to real phone numbers.
              </p>
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
