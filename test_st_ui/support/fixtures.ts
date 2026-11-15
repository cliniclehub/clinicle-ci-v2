import { test as base, expect } from '@playwright/test'

import { ContactPage } from '../pages/contact.page'
import { ForgotPasswordPage } from '../pages/forgot-password.page'
import { LoginPage } from '../pages/login.page'
import { RegisterPage } from '../pages/register.page'
import { SiteLandingPage } from '../pages/site-landing.page'
import { AppShellPage } from '../pages/app-shell.page'
import { createSeedContext } from '../seed/builders/context'
import { scenarios, type Scenarios } from '../seed/scenarios'
import * as dbHelpers from '../seed/db'

type PageFixtures = {
  loginPage: LoginPage
  registerPage: RegisterPage
  siteLandingPage: SiteLandingPage
  contactPage: ContactPage
  forgotPasswordPage: ForgotPasswordPage
  appShell: AppShellPage
}

type SeedWorkerFixtures = {
  seed: Scenarios
  db: typeof dbHelpers
}

export const test = base.extend<PageFixtures, SeedWorkerFixtures>({
  seed: [
    async ({}, use) => {
      await use(scenarios(createSeedContext()))
    },
    { scope: 'worker' },
  ],
  db: [
    async ({}, use) => {
      await use(dbHelpers)
      await dbHelpers.closeDb().catch(() => undefined)
    },
    { scope: 'worker' },
  ],
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page))
  },
  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page))
  },
  siteLandingPage: async ({ page }, use) => {
    await use(new SiteLandingPage(page))
  },
  contactPage: async ({ page }, use) => {
    await use(new ContactPage(page))
  },
  forgotPasswordPage: async ({ page }, use) => {
    await use(new ForgotPasswordPage(page))
  },
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page))
  },
})

export { expect }
