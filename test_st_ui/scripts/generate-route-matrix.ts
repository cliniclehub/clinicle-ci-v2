/**
 * Generates support/matrices/route-roles.json from the frontend's canonical route ACL
 * (fe/lib/utils/middleware-route-policy.ts — pure TS, imported directly, no parsing).
 *
 * Run: npm run matrix:generate  (from test_st_ui/)
 *
 * The JSON is checked in. Re-running after FE changes produces a git diff: an intentional
 * policy change updates the snapshot in the same PR; an unintentional one fails review and
 * the matrix suite (tests/matrix/route-access.spec.ts) catches it at runtime too.
 *
 * Clinicle Intelligence placeholder routes (see INTELLIGENCE_PLACEHOLDER_PREFIXES /
 * `__clinicle-intelligence-old`) are excluded — ST UI covers framework + platform FE only.
 */

import fs from 'fs'
import path from 'path'

import {
  INTELLIGENCE_PLACEHOLDER_PREFIXES,
  MIDDLEWARE_PERMISSION_PREFIX_RULES,
  MIDDLEWARE_ROLE_PATTERN_RULES,
  MIDDLEWARE_ROLE_PREFIX_RULES,
  PROTECTED_ROUTE_PREFIXES,
  PUBLIC_ROUTE_PREFIXES,
} from '../../fe/lib/utils/middleware-route-policy'

export interface RouteMatrix {
  generatedFrom: string
  publicPrefixes: string[]
  /** Protected prefixes with no role restriction (any authenticated user). */
  authenticatedOnlyPrefixes: string[]
  /** Prefix → allowed role keys. */
  rolePrefixRules: Record<string, string[]>
  /** Regex source → allowed role keys (evaluated before prefix rules). */
  rolePatternRules: Array<{ pattern: string; roles: string[] }>
}

const intelligencePrefixes = new Set<string>(INTELLIGENCE_PLACEHOLDER_PREFIXES)

function systemRolesForPermissionPrefix(prefix: string): string[] {
  if (prefix.startsWith('/platform-') || prefix === '/dashboard-super-admin') {
    return ['super_admin']
  }
  // org_owner holds the same org.* catalog grants as org_admin and implies org_admin
  // for role-key checks (fe/lib/utils/role-implications.ts).
  return ['org_owner', 'org_admin']
}

const rolePrefixRules: Record<string, string[]> = {}
for (const [prefix, roles] of Object.entries(MIDDLEWARE_ROLE_PREFIX_RULES)) {
  if (intelligencePrefixes.has(prefix)) continue
  rolePrefixRules[prefix] = [...roles]
}
for (const prefix of Object.keys(MIDDLEWARE_PERMISSION_PREFIX_RULES)) {
  if (intelligencePrefixes.has(prefix)) continue
  rolePrefixRules[prefix] = systemRolesForPermissionPrefix(prefix)
}

const matrix: RouteMatrix = {
  generatedFrom: 'fe/lib/utils/middleware-route-policy.ts',
  publicPrefixes: [...PUBLIC_ROUTE_PREFIXES],
  authenticatedOnlyPrefixes: PROTECTED_ROUTE_PREFIXES.filter(
    (prefix) =>
      !intelligencePrefixes.has(prefix) &&
      !(prefix in MIDDLEWARE_ROLE_PREFIX_RULES) &&
      !(prefix in MIDDLEWARE_PERMISSION_PREFIX_RULES),
  ),
  rolePrefixRules,
  rolePatternRules: MIDDLEWARE_ROLE_PATTERN_RULES.map((rule) => ({
    pattern: rule.pattern.source,
    roles: [...rule.roles],
  })),
}

const outPath = path.join(__dirname, '..', 'support', 'matrices', 'route-roles.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n')
console.log(
  `Wrote ${outPath}: ${matrix.publicPrefixes.length} public, ` +
    `${Object.keys(matrix.rolePrefixRules).length} role-gated prefixes, ` +
    `${matrix.rolePatternRules.length} pattern rules, ` +
    `${matrix.authenticatedOnlyPrefixes.length} auth-only prefixes ` +
    `(excluded ${intelligencePrefixes.size} intelligence placeholders)`,
)
