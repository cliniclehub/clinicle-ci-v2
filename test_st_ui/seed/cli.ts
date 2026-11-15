/**
 * Seed CLI — run from test_st_ui/:
 *
 *   npm run seed:check                      # connectivity: API login + DB reachable
 *   npm run seed:bootstrap                  # ensure Test Org A/B + personas exist
 *   npm run seed:scenario -- <name>         # run one scenario, print resulting IDs as JSON
 *   npm run seed:cleanup -- [--run-id X] [--older-than-days N] [--dry-run]
 */

import { createBootstrapContext, createSeedContext } from './builders/context'
import { ensureOrg, FLAG_PROFILE_ORGS } from './builders/org'
import {
  completeProfile,
  createUserViaPlatform,
  DEFAULT_SEED_PASSWORD,
  type OrgRoleKey,
} from './builders/users'
import { cleanupRunData } from './cleanup'
import { closeDb, db, userIdForEmail } from './db'
import { hasDatabaseUrl, apiBaseUrl, appBaseUrl, orgDomain, databaseSchema } from './env'
import { fixtureEmail } from './run-id'
import { scenarios } from './scenarios'

const PRIMARY_SUBDOMAIN = 'testorg-a'

async function check(): Promise<void> {
  console.log(`App: ${appBaseUrl()}  API: ${apiBaseUrl()}  Org: ${orgDomain()}`)
  const ctx = createSeedContext()
  if (!ctx.orgAdmin) {
    throw new Error('Set ST_ORG_ADMIN_EMAIL/PASSWORD in test_st_ui/.env')
  }
  const token = await ctx.sessions.token(
    ctx.orgAdmin.email,
    ctx.orgAdmin.password,
    ctx.orgDomain,
  )
  console.log(`API login OK as ${ctx.orgAdmin.email} (token ${token.slice(0, 12)}…)`)
  if (hasDatabaseUrl()) {
    const result = await db().query(
      `SELECT count(*) AS n FROM ${databaseSchema()}.organizations`,
    )
    console.log(`DB OK — ${result.rows[0].n} organizations`)
  } else {
    console.log('ST_DATABASE_URL not set — DB helpers and cleanup unavailable')
  }
}

const PERSONAS: Record<string, OrgRoleKey[]> = {
  'testorg-a': ['org_owner', 'org_admin', 'user'],
  'testorg-b': ['org_owner', 'org_admin', 'user'],
}

async function bootstrap(): Promise<void> {
  const ctx = createBootstrapContext()
  const primaryLines: string[] = []
  const tenantBLines: string[] = []
  let tenantBDomain = 'testorg-b.clinicle-ci.local'

  for (const [subdomain, profile] of Object.entries(FLAG_PROFILE_ORGS)) {
    const org = await ensureOrg(ctx, subdomain, profile)
    console.log(`✔ org ${org.domain} (${org.id})${org.created ? ' [created]' : ''}`)

    for (const role of PERSONAS[subdomain] ?? []) {
      const email = fixtureEmail(`${subdomain}-${role.replace(/_/g, '-')}`, org.domain)
      const exists = await userIdForEmail(email, org.id).catch(() => undefined)
      if (!exists) {
        await createUserViaPlatform(ctx, {
          organizationId: org.id,
          email,
          roles: [role],
          label: `${subdomain}-${role}`,
        })
        console.log(`  ✔ ${role}: ${email} [created]`)
      } else {
        console.log(`  ✔ ${role}: ${email}`)
      }
      try {
        await completeProfile(ctx, { email, password: DEFAULT_SEED_PASSWORD }, org.domain)
        console.log(`    ✔ profile completed`)
      } catch (error) {
        console.log(`    ✖ profile completion failed: ${String(error).slice(0, 160)}`)
      }

      const envKey = role.toUpperCase()
      if (subdomain === PRIMARY_SUBDOMAIN) {
        primaryLines.push(`ST_${envKey}_EMAIL=${email}`)
        primaryLines.push(`ST_${envKey}_PASSWORD=${DEFAULT_SEED_PASSWORD}`)
      } else {
        tenantBDomain = org.domain
        tenantBLines.push(`ST_TENANT_B_${envKey}_EMAIL=${email}`)
        tenantBLines.push(`ST_TENANT_B_${envKey}_PASSWORD=${DEFAULT_SEED_PASSWORD}`)
      }
    }
  }

  console.log('\n# Paste into test_st_ui/.env (ST_* = system-test credentials):')
  console.log('PLAYWRIGHT_BASE_URL=https://testorg-a.clinicle-ci.local')
  console.log('ORG_DOMAIN=testorg-a.clinicle-ci.local')
  console.log('ST_SUPER_ADMIN_BASE_URL=https://admin.clinicle-ci.local')
  console.log(primaryLines.join('\n'))
  console.log(`ST_TENANT_B_DOMAIN=${tenantBDomain}`)
  console.log(tenantBLines.join('\n'))
}

async function runScenario(name: string): Promise<void> {
  const s = scenarios()
  const fn = (s as unknown as Record<string, () => Promise<unknown>>)[name]
  if (typeof fn !== 'function') {
    const names = Object.keys(s).filter((k) => k !== 'ctx')
    throw new Error(`Unknown scenario "${name}". Available: ${names.join(', ')}`)
  }
  const result = await fn.call(s)
  console.log(JSON.stringify(result, null, 2))
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const command = process.argv[2]
  try {
    switch (command) {
      case 'check':
        await check()
        break
      case 'bootstrap':
        await bootstrap()
        break
      case 'scenario':
        await runScenario(process.argv[3] ?? '')
        break
      case 'cleanup':
        await cleanupRunData({
          runId: argValue('--run-id'),
          olderThanDays: argValue('--older-than-days')
            ? Number(argValue('--older-than-days'))
            : undefined,
          dryRun: process.argv.includes('--dry-run'),
        })
        break
      default:
        console.log(
          'Usage: seed <check|bootstrap|scenario <name>|cleanup [--run-id X] [--older-than-days N] [--dry-run]>',
        )
        process.exitCode = 1
    }
  } finally {
    await closeDb().catch(() => undefined)
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
