"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { useState } from "react"

export function SecuritySettings() {
  const [isLoading, setIsLoading] = useState(false)
  const [passwordLength, setPasswordLength] = useState([12])

  const handleSave = async () => {
    setIsLoading(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setIsLoading(false)
    toast.success("Security settings have been updated successfully.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security Settings</CardTitle>
        <CardDescription>
          Configure platform-wide security settings, authentication methods, and compliance requirements.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Authentication</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch id="auth-email-password" defaultChecked />
              <Label htmlFor="auth-email-password">Email/Password Authentication</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="auth-google" defaultChecked />
              <Label htmlFor="auth-google">Google Authentication</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="auth-microsoft" />
              <Label htmlFor="auth-microsoft">Microsoft Authentication</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="auth-apple" />
              <Label htmlFor="auth-apple">Apple Authentication</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="auth-saml" />
              <Label htmlFor="auth-saml">SAML/SSO Integration</Label>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-lg font-medium">Password Policy</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="password-length">Minimum Password Length: {passwordLength[0]}</Label>
              </div>
              <Slider
                id="password-length"
                min={8}
                max={24}
                step={1}
                value={passwordLength}
                onValueChange={setPasswordLength}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Switch id="password-uppercase" defaultChecked />
                <Label htmlFor="password-uppercase">Require Uppercase Letters</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="password-lowercase" defaultChecked />
                <Label htmlFor="password-lowercase">Require Lowercase Letters</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="password-numbers" defaultChecked />
                <Label htmlFor="password-numbers">Require Numbers</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="password-special" defaultChecked />
                <Label htmlFor="password-special">Require Special Characters</Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password-expiry">Password Expiry (days)</Label>
              <Select defaultValue="90">
                <SelectTrigger id="password-expiry">
                  <SelectValue placeholder="Select expiry period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="180">180 days</SelectItem>
                  <SelectItem value="365">365 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-lg font-medium">Two-Factor Authentication (2FA)</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch id="2fa-enabled" defaultChecked />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="2fa-enabled">Enable 2FA</Label>
                <p className="text-sm text-muted-foreground">Allow users to enable two-factor authentication</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="2fa-method">Default 2FA Method</Label>
              <Select defaultValue="app">
                <SelectTrigger id="2fa-method">
                  <SelectValue placeholder="Select 2FA method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="app">Authenticator App</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch id="2fa-required-admin" defaultChecked />
              <Label htmlFor="2fa-required-admin">Require 2FA for Admin Users</Label>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-lg font-medium">Session Security</h3>
          <div className="space-y-2">
            <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
            <Select defaultValue="60">
              <SelectTrigger id="session-timeout">
                <SelectValue placeholder="Select timeout period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
                <SelectItem value="480">8 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Switch id="session-device-tracking" defaultChecked />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="session-device-tracking">Device Tracking</Label>
              <p className="text-sm text-muted-foreground">Track and manage user login devices</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-lg font-medium">Compliance</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Switch id="compliance-gdpr" defaultChecked />
              <Label htmlFor="compliance-gdpr">GDPR Compliance</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="compliance-ccpa" defaultChecked />
              <Label htmlFor="compliance-ccpa">CCPA Compliance</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="compliance-coppa" defaultChecked />
              <Label htmlFor="compliance-coppa">COPPA Compliance</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="compliance-ferpa" defaultChecked />
              <Label htmlFor="compliance-ferpa">FERPA Compliance</Label>
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
