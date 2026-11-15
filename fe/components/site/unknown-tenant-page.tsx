import {
  UNKNOWN_TENANT_HEADING,
  unknownTenantDescription,
} from "@/lib/utils/unknown-tenant"

export function UnknownTenantPage({ hostname }: { hostname: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16">
      <div className="max-w-lg text-center">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Site not found</p>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">
          {UNKNOWN_TENANT_HEADING}
        </h1>
        <p className="text-muted-foreground">{unknownTenantDescription(hostname)}</p>
      </div>
    </main>
  )
}
