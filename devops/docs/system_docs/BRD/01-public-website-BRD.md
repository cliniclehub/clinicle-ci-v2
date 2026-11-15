# Public Website — Business Requirements Document

Status: draft (baseline capture)  
Last updated: 2026-09-30  
Design: [`01-public-website-SDD.md`](../SDD/01-public-website-SDD.md)  
UI system tests: [`01-public-website-ST-UI.md`](../ST-UI/01-public-website-ST-UI.md)  
API system tests: [`organizations-ST-API.md`](../ST-API/organizations-ST-API.md)

## Purpose

Tenant-aware public surface for visitors: landing content, legal pages, and
contact entry points resolved from the request hostname’s organization.

## Business objective

Give each organization a branded public presence without requiring sign-in, while
keeping content and policies tenant-scoped.

## Scope

### In scope

- Hostname → organization resolution for public pages
- Landing page content (org-configured HTML / theme)
- Terms of use and privacy policy display
- Contact / support entry points using org contact fields
- Unauthorized / access-denied public page

### Out of scope

- Authenticated dashboards and admin consoles
- Marketing CMS or multi-page site builder
- Public catalog / commerce (not in this baseline)

## Actors

- **Visitor:** unauthenticated browser user on a tenant hostname
- **Organization admin / owner:** configures landing and legal content
- **Platform super admin:** provisions organizations that own public content

## Business rules

1. Public content is resolved from the request host / tenant domain.
2. Inactive organizations must not expose a normal public experience.
3. Legal pages use organization-stored terms and privacy content when present.
4. Public pages must not leak other tenants’ branding or content.

## User stories and completion criteria

### PW-01 — View tenant landing

As a visitor, I want to see the organization’s landing content for the hostname I opened.

Completion criteria:

- Correct organization is resolved from host/domain.
- Landing HTML/theme for that org is rendered.
- Peer-tenant content is never shown.

### PW-02 — Read legal pages

As a visitor, I want to open terms of use and privacy policy for this tenant.

Completion criteria:

- Routes under the public group serve org-scoped legal content.
- Missing content degrades safely (empty/placeholder, not another tenant’s text).

### PW-03 — Reach contact / support info

As a visitor, I want contact or support channels for this organization.

Completion criteria:

- Contact page uses org support/info fields when configured.

### PW-04 — See unauthorized guidance

As a visitor or signed-in user without access, I want a clear unauthorized page.

Completion criteria:

- `/unauthorized` explains access denial without exposing privileged data.

## Cross-module dependencies

- Organization lifecycle (branding, legal, contact fields)
- Authorization (route guards that redirect to unauthorized)

## Analytics impact

No analytics impact for the baseline public pages beyond optional org tracking
scripts already stored on the organization record. No irreversible business
facts are owned here.

## Known product decisions and gaps

- Intelligence and product marketing surfaces beyond landing are out of scope
  for this module.
- Tracking scripts are org-configured; validation/sanitization policy should
  stay explicit in the org SDD.

## Business sign-off boundary

Public content correctness and tenant isolation for hostname-based pages.
