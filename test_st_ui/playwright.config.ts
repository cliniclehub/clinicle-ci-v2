import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

import { DEFAULT_BASE_URL } from './support/constants'
import { ST_ROLES, roleFolderPattern, stSuperAdminBaseUrl } from './support/roles'

dotenv.config({ path: path.join(__dirname, '.env') })

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL
const authDir = path.join(__dirname, '.auth')
const slowMoMs = process.env.PLAYWRIGHT_SLOW_MO
  ? Number(process.env.PLAYWRIGHT_SLOW_MO)
  : undefined
const launchOptions =
  slowMoMs !== undefined && !Number.isNaN(slowMoMs) ? { slowMo: slowMoMs } : undefined

/** Apply slowMo on every project — global use.launchOptions alone is not always inherited. */
function withLaunchOptions<T extends Record<string, unknown>>(device: T) {
  return launchOptions ? { ...device, launchOptions } : device
}

const desktopChrome = withLaunchOptions(devices['Desktop Chrome'])
const pixel7 = withLaunchOptions(devices['Pixel 7'])

/** Headed/slow debugging: one browser at a time so slowMo is visible for every test. */
const debugRun =
  Boolean(launchOptions) ||
  process.env.ST_SINGLE_WORKER === '1' ||
  process.env.E2E_SINGLE_WORKER === '1'

const roleSetupProjects = ST_ROLES.map((role) => ({
  name: `setup-${role.slug}`,
  testMatch: /auth\.setup\.ts/,
  grep: new RegExp(role.setupTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
}))

const roleTestProjects = ST_ROLES.map((role) => ({
  name: role.slug,
  testMatch: roleFolderPattern(role.slug),
  dependencies: [`setup-${role.slug}`],
  use: {
    ...desktopChrome,
    storageState: path.join(authDir, `${role.slug}.json`),
  },
}))

/** Mobile-viewport variants: same role specs, filtered to @mobile-critical journeys. */
const roleMobileProjects = ST_ROLES.map((role) => ({
  name: `${role.slug}-mobile`,
  testMatch: roleFolderPattern(role.slug),
  grep: /@mobile-critical/,
  dependencies: [`setup-${role.slug}`],
  use: {
    ...pixel7,
    storageState: path.join(authDir, `${role.slug}.json`),
  },
}))

/** Route-access matrix (tests/matrix/) per role + anonymous — see README.md Architecture. */
const matrixProjects = [
  {
    name: 'matrix-anonymous',
    testMatch: /matrix\/.*\.spec\.ts/,
    use: desktopChrome,
  },
  ...ST_ROLES.map((role) => ({
    name: `matrix-${role.slug}`,
    testMatch: /matrix\/.*\.spec\.ts/,
    dependencies: [`setup-${role.slug}`],
    use: {
      ...desktopChrome,
      storageState: path.join(authDir, `${role.slug}.json`),
      // super_admin lives on the platform host, not an org subdomain.
      ...(role.slug === 'super-admin' && stSuperAdminBaseUrl()
        ? { baseURL: stSuperAdminBaseUrl() }
        : {}),
    },
  })),
]

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI || debugRun ? 1 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions,
  },
  projects: [
    ...roleSetupProjects,

    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      testIgnore: /mobile\.spec\.ts/,
      use: desktopChrome,
    },
    {
      name: 'smoke-mobile',
      testMatch: /smoke\/mobile\.spec\.ts/,
      use: pixel7,
    },
    {
      name: 'auth',
      testMatch: /auth\/.*\.spec\.ts/,
      testIgnore: /auth\.setup\.ts/,
      use: desktopChrome,
    },
    {
      // Cross-tenant / privilege boundaries. Driven through the API (that is where the
      // boundary lives), so no storageState or role dependency.
      name: 'security',
      testMatch: /security\/.*\.spec\.ts/,
      use: desktopChrome,
    },

    ...roleTestProjects,
    ...roleMobileProjects,
    ...matrixProjects,
  ],
})
