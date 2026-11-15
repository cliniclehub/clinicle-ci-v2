import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function OrganizationAdminPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Admin</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Internal organization tools. This page is not linked from navigation.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No admin tools available</CardTitle>
          <CardDescription>
            Product-specific admin tools can be added to this platform shell.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
