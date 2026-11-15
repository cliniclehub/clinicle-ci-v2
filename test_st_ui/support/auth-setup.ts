import fs from 'fs'
import path from 'path'

import { expect, type Page } from '@playwright/test'

import { ROUTES } from './constants'
import { LoginPage } from '../pages/login.page'

export interface SaveAuthSessionOptions {
  /** Force this app role in localStorage so multi-role accounts match the E2E project. */
  appRoleId?: string
  /** Override login host (e.g. super_admin on app.midad.local while org tests use suhba). */
  loginBaseUrl?: string
}

export async function saveAuthSession(
  page: Page,
  email: string,
  password: string,
  authFile: string,
  options: SaveAuthSessionOptions = {},
): Promise<void> {
  const login = new LoginPage(page)
  if (options.loginBaseUrl) {
    await page.goto(new URL(ROUTES.login, options.loginBaseUrl).toString())
    await login.expectOnPage()
  } else {
    await login.open()
  }
  await login.signIn(email, password)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })

  if (options.appRoleId) {
    await page.evaluate((role) => {
      localStorage.setItem('activeRole', role)
    }, options.appRoleId)
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  await page.context().storageState({ path: authFile })
}
