"use client";

import { DeploymentSkewHandler } from "@/components/site/deployment-skew-handler";
import { DynamicFavicon } from "@/components/site/dynamic-favicon";
import { GtmNoscript } from "@/components/site/gtm-noscript";
import { OrgTrackingScripts } from "@/components/site/org-tracking-scripts";
import { ThemeLoader } from "@/components/site/theme-loader";
import { ThemeProvider } from "@/components/site/theme-provider";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/contexts/auth-context";
import { OrgWhiteLabelProvider } from "@/lib/contexts/org-white-label-context";
import { LanguageProvider } from "@/lib/contexts/language-context";
import type { Language } from "@/lib/i18n/locale";
import { RoleProvider } from "@/lib/contexts/role-context";
import { ThemeProvider as CustomThemeProvider } from "@/lib/contexts/theme-context";

export function AppProviders({
  children,
  initialLanguage,
}: {
  children: React.ReactNode;
  initialLanguage?: Language;
}) {
  return (
    <AuthProvider>
      <OrgWhiteLabelProvider>
        <DeploymentSkewHandler />
        <GtmNoscript />
        <DynamicFavicon />
        <OrgTrackingScripts />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <CustomThemeProvider>
            <ThemeLoader>
              <LanguageProvider initialLanguage={initialLanguage}>
                <RoleProvider>
                  {children}
                  <SonnerToaster />
                </RoleProvider>
              </LanguageProvider>
            </ThemeLoader>
          </CustomThemeProvider>
        </ThemeProvider>
      </OrgWhiteLabelProvider>
    </AuthProvider>
  );
}
