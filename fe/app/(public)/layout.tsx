/**
 * Public pages (no sidebar, no profile-completion guard).
 * Used for email links: family invitations, legal pages, catalog, etc.
 */
import { AppVersionStrip } from "@/components/site/app-version-strip"

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <div className="pb-10">{children}</div>
      <AppVersionStrip />
    </>
  )
}
