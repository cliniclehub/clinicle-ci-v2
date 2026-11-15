import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Building, Settings, Shield, Users } from "lucide-react"

interface SiteLandingDefaultHeroProps {
  organizationName: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
}

export function SiteLandingDefaultHero({
  organizationName,
  primaryColor,
  secondaryColor,
  accentColor,
}: SiteLandingDefaultHeroProps) {
  const dynamicStyles = {
    primaryText: { color: primaryColor },
    primaryLight: { backgroundColor: `${primaryColor}1a` },
    accentText: { color: accentColor },
    accentLight: { backgroundColor: `${accentColor}1a` },
  }

  return (
    <>
      <div className="text-center mb-16 max-w-3xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-5">
          {organizationName}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-4">
          Welcome to {organizationName}. Sign in to access your workspace, profile, and
          organization tools.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
        <Card className="text-center hover:shadow-lg transition-shadow">
          <CardHeader>
            <div
              className="mx-auto w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={dynamicStyles.primaryLight}
            >
              <Users className="h-6 w-6" style={dynamicStyles.primaryText} />
            </div>
            <CardTitle className="text-lg">People</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Manage members and organization access from one place.
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="text-center hover:shadow-lg transition-shadow">
          <CardHeader>
            <div
              className="mx-auto w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={dynamicStyles.accentLight}
            >
              <Building className="h-6 w-6" style={dynamicStyles.accentText} />
            </div>
            <CardTitle className="text-lg">Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Branding, settings, and workspace details for your organization.
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="text-center hover:shadow-lg transition-shadow">
          <CardHeader>
            <div
              className="mx-auto w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={{ backgroundColor: `${secondaryColor}1a` }}
            >
              <Settings className="h-6 w-6" style={{ color: secondaryColor }} />
            </div>
            <CardTitle className="text-lg">Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Email, notifications, and media tools for day-to-day operations.
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="text-center hover:shadow-lg transition-shadow">
          <CardHeader>
            <div
              className="mx-auto w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={{ backgroundColor: `${primaryColor}33` }}
            >
              <Shield className="h-6 w-6" style={dynamicStyles.primaryText} />
            </div>
            <CardTitle className="text-lg">Access</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Role-based access for members, organization admins, and platform admins.
            </CardDescription>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
