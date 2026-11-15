# Frontend i18n

Custom client + cookie locale stack (`LanguageProvider`). Supported UI locales: **en**, **es**, **ar** (RTL).

## Layout

- Namespaces: `fe/translations/{en,es,ar}/*.json` (en is source of truth)
- Helpers: `fe/lib/i18n/locale.ts`, `fe/lib/i18n/messages.ts`
- Provider: `fe/lib/contexts/language-context.tsx`
- First paint: `NEXT_LOCALE` cookie → root `layout.tsx` sets `<html lang dir>`

## Key parity

```bash
cd fe && npm run check:i18n
```

## next-intl evaluation (Phase 3)

Stay on the custom stack unless one of these becomes a hard requirement:

1. **URL locales** (`/ar/login`, SEO per language)
2. **ICU plurals / rich message formatting** across many modules
3. **Middleware-driven org default locale** at request edge

RTL, Arabic fonts, and shell switching do not require `next-intl`. Migrating later is mostly swapping `t()` + message file loaders.

## Email / backend catalogs

Email BRD/SDD mention EN/AR/FR template language, but `email_templates` has no `language` column yet. Defer backend/email localization to a dedicated email-engine change; UI JSON is not the right home for transactional email copy.
