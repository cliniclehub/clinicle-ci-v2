/**
 * Direct Postgres access to the target environment.
 *
 * Schema defaults to `app`; set ST_DATABASE_SCHEMA=ci for the local docker dump
 * (matches be/config/.env.local DB_SCHEMA).
 */

import { Pool, type QueryResultRow } from 'pg'

import { databaseSchema, databaseUrl } from './env'

let pool: Pool | undefined

function schema(): string {
  const name = databaseSchema()
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ST_DATABASE_SCHEMA: ${name}`)
  }
  return name
}

function q(table: string): string {
  return `${schema()}.${table}`
}

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 3,
      ssl: databaseUrl().includes('.render.com') ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const result = await db().query<T>(sql, params)
  return result.rows[0]
}

export async function organizationIdForDomain(domain: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${q('organizations')} WHERE domain = $1 LIMIT 1`,
    [domain],
  )
  if (!row) throw new Error(`No organization found for domain ${domain}`)
  return row.id
}

export async function userIdForEmail(email: string, organizationId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${q('users')} WHERE email = $1 AND organization_id = $2 LIMIT 1`,
    [email, organizationId],
  )
  if (!row) throw new Error(`No user ${email} in org ${organizationId}`)
  return row.id
}

export async function latestEmailVerificationCode(userId: string): Promise<string> {
  const row = await queryOne<{ code: string }>(
    `SELECT code FROM ${q('email_verification_codes')}
     WHERE user_id = $1 AND used = false
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId],
  )
  if (!row) throw new Error(`No unused email verification code for user ${userId}`)
  return row.code
}

let corroborationProbe: Promise<boolean> | undefined

export function dbCorroborationAvailable(): Promise<boolean> {
  if (!corroborationProbe) {
    corroborationProbe = (async () => {
      const { hasDatabaseUrl } = await import('./env.js')
      if (!hasDatabaseUrl()) return false
      try {
        await queryOne('SELECT 1 AS ok')
        return true
      } catch {
        return false
      }
    })()
  }
  return corroborationProbe
}
