"use client"

import { AppVersionLabel } from "@/components/site/app-version-label"
import { useLanguage } from "@/lib/contexts/language-context"
import { useOrgWhiteLabelData } from "@/lib/hooks/use-org-white-label-data"

export function Footer() {
  const currentYear = new Date().getFullYear()
  const { t } = useLanguage()
  const { name } = useOrgWhiteLabelData()
  const orgName = name?.trim() || "Platform"

  return (
    <footer className="bg-background border-t border-border py-3 px-6 z-10 w-full">
      <div className="flex flex-col md:flex-row justify-between items-center max-w-7xl mx-auto gap-2">
        <div className="text-sm text-muted-foreground text-center md:text-start">
          &copy; {currentYear} {orgName}. {t("footer.allRightsReserved")}.
        </div>

        <div className="flex gap-4">
          <a href="/privacy-policy" className="text-sm text-muted-foreground hover:text-foreground underline">
            {t("footer.privacyPolicy")}
          </a>
          <a href="/terms-of-use" className="text-sm text-muted-foreground hover:text-foreground underline">
            {t("footer.termsOfUse")}
          </a>
        </div>

        <div className="text-sm text-muted-foreground text-center md:text-end">
          {t("auth.poweredBy")}
          <AppVersionLabel className="mt-0.5" />
        </div>
      </div>
    </footer>
  )
}
