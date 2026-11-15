import { AppProviders } from "@/app/providers";
import { UnknownTenantPage } from "@/components/site/unknown-tenant-page";
import { lookupOrgWhiteLabelByDomain } from "@/lib/actions/organizations/organizations-org-actions";
import { appBuild } from "@/lib/build-info";
import { DEFAULT_APP_DESCRIPTION, DEFAULT_APP_NAME } from "@/lib/config/app-brand";
import {
  getDir,
  getHtmlLang,
  isRtl,
  LOCALE_COOKIE_NAME,
  parseLanguage,
} from "@/lib/i18n/locale";
import { buildDeploymentSkewInlineScript } from "@/lib/utils/deployment-skew-guard";
import { normalizeDnsHostname } from "@/lib/utils/org-platform-domain";
import {
  shouldReplaceAppWithUnknownTenantPage,
  UNKNOWN_TENANT_SITE_TITLE,
  unknownTenantDescription,
} from "@/lib/utils/unknown-tenant";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";

function requestHostname(headerStore: Headers): string {
  return normalizeDnsHostname(
    headerStore.get("host") || headerStore.get("x-forwarded-host") || ""
  );
}

function getMetadataBase(): URL {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw.endsWith("/") ? raw.slice(0, -1) : raw);
    } catch {
      /* fall through */
    }
  }
  return new URL(`http://localhost:${process.env.PORT || "3000"}`);
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupOrgWhiteLabelByDomain();
  const hostname = requestHostname(await headers());

  if (
    shouldReplaceAppWithUnknownTenantPage({
      lookupStatus: lookup.status,
      hostname,
    })
  ) {
    const title = UNKNOWN_TENANT_SITE_TITLE;
    const description = unknownTenantDescription(hostname);
    return {
      metadataBase: getMetadataBase(),
      title,
      description,
      robots: { index: false, follow: false },
      icons: { icon: "/favicon.ico" },
    };
  }

  const org = lookup.status === "found" ? lookup.data : undefined;
  const title = org?.name?.trim() || DEFAULT_APP_NAME;
  const description = org?.name?.trim() || DEFAULT_APP_DESCRIPTION;

  return {
    metadataBase: getMetadataBase(),
    title: {
      default: title,
      template: `%s | ${title}`,
    },
    description,
    icons: {
      icon: org?.faviconUrl || "/favicon.ico",
    },
    openGraph: {
      title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lookup = await lookupOrgWhiteLabelByDomain();
  const hostname = requestHostname(await headers());
  const unknownTenant = shouldReplaceAppWithUnknownTenantPage({
    lookupStatus: lookup.status,
    hostname,
  });
  const cookieStore = await cookies();
  const language = parseLanguage(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const dir = getDir(language);
  const htmlLang = getHtmlLang(language);
  const rtlClass = isRtl(language) ? "rtl" : "";

  return (
    <html
      lang={htmlLang}
      dir={dir}
      className={rtlClass}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: buildDeploymentSkewInlineScript(appBuild || "unknown"),
          }}
        />
        {unknownTenant ? (
          <UnknownTenantPage hostname={hostname} />
        ) : (
          <AppProviders initialLanguage={language}>{children}</AppProviders>
        )}
      </body>
    </html>
  );
}
