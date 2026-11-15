import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsList } from "@/components/ui/tabs"

export default function PlatformSettingsLoading() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <Skeleton className="h-10 w-[250px]" />
        <Skeleton className="h-4 w-[450px] mt-2" />
      </div>

      <Tabs defaultValue="email" className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </TabsList>

        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-[200px]" />
            <Skeleton className="h-4 w-[300px]" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-[150px]" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
            <Skeleton className="h-10 w-[120px] mt-4" />
          </CardContent>
        </Card>
      </Tabs>
    </div>
  )
}
