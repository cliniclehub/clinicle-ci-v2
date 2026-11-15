/**
 * Cleanup of run-scoped seeded users. Everything a run creates is e-mailed with
 * the `st+run-` prefix (run-id.ts). Legacy `e2e+run-` rows are also cleaned.
 */

import { db, queryOne } from './db'
import { databaseSchema } from './env'

const RUN_EMAIL_PATTERNS = ['st+run-%', 'e2e+run-%'] as const

function q(table: string): string {
  const name = databaseSchema()
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ST_DATABASE_SCHEMA: ${name}`)
  }
  return `${name}.${table}`
}

async function harnessOrgIds(): Promise<string[]> {
  const result = await db().query<{ id: string }>(
    `SELECT id FROM ${q('organizations')}
     WHERE domain LIKE 'testorg-a.%'
        OR domain LIKE 'testorg-b.%'
        OR domain LIKE 'acme.%'
        OR domain LIKE 'globex.%'
        OR domain LIKE 'st-%'
        OR domain LIKE 'e2e-%'`,
  )
  return result.rows.map((row) => row.id)
}

export interface CleanupOptions {
  runId?: string
  olderThanDays?: number
  dryRun?: boolean
}

export async function cleanupRunData(options: CleanupOptions = {}): Promise<void> {
  const orgIds = await harnessOrgIds()
  if (orgIds.length === 0) {
    console.log('No harness organizations found; nothing to clean.')
    return
  }

  const patterns = options.runId
    ? [`st+run-${options.runId}-%`, `e2e+run-${options.runId}-%`]
    : [...RUN_EMAIL_PATTERNS]
  const ageFilter = options.olderThanDays
    ? `AND created_at < now() - interval '${Math.floor(options.olderThanDays)} days'`
    : ''

  let total = 0
  for (const emailPattern of patterns) {
    const where = `organization_id = ANY($1) AND email LIKE $2 ${ageFilter}`
    const countRow = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM ${q('users')} WHERE ${where}`,
      [orgIds, emailPattern],
    )
    const count = Number(countRow?.n ?? 0)
    if (options.dryRun) {
      console.log(`[dry-run] would delete ${count} rows matching ${emailPattern}`)
      total += count
      continue
    }
    if (count > 0) {
      await db().query(`DELETE FROM ${q('users')} WHERE ${where}`, [orgIds, emailPattern])
      console.log(`Deleted ${count} rows matching ${emailPattern}`)
      total += count
    }
  }
  if (total === 0 && !options.dryRun) {
    console.log('No run-scoped users to delete.')
  }
}
