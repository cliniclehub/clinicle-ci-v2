import { expect, type Locator, type Page } from '@playwright/test'

import { ROUTES } from '../support/constants'
import { BasePage } from './base.page'

export class ForgotPasswordPage extends BasePage {
  readonly heading: Locator
  readonly emailInput: Locator
  readonly submitButton: Locator
  readonly backToSignInLink: Locator

  readonly backButton: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByRole('heading', { level: 2, name: /reset your password/i })
    this.emailInput = page.getByLabel(/email address/i)
    this.submitButton = page.getByRole('button', { name: /send reset code/i })
    this.backToSignInLink = page.getByRole('link', { name: /back to login/i })
    // The back control is an icon-only <a href="/login"> with no accessible name, so neither a
    // role+name lookup nor the old "first button containing an svg" match finds it. Target the
    // href until the FE gives it an aria-label (a11y gap — see README selector policy).
    this.backButton = page.locator('a[href="/login"]').first()
  }

  async open(): Promise<void> {
    await this.goto(ROUTES.forgotPassword)
    await expect(this.heading).toBeVisible({ timeout: 60_000 })
  }

  async expectOnPage(): Promise<void> {
    await expect(this.heading).toBeVisible()
    await expect(this.emailInput).toBeVisible()
  }
}
