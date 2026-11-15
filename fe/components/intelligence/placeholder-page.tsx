import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface IntelligencePlaceholderPageProps {
  title: string
  description?: string
}

export function IntelligencePlaceholderPage({
  title,
  description = "This Clinicle Intelligence view is a placeholder while the legacy console is migrated into this platform.",
}: IntelligencePlaceholderPageProps) {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">Coming soon</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
