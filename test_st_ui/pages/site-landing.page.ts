import { expect, type Locator, type Page } from '@playwright/test'

import { ROUTES } from '../support/constants'
import { BasePage } from './base.page'

export class SiteLandingPage extends BasePage {
  readonly signInLink: Locator
  readonly signUpLink: Locator
  readonly browseCatalogButton: Locator
  readonly footerContactLink: Locator

  constructor(page: Page) {
    super(page)
    this.signInLink = page.getByRole('link', { name: /sign in/i })
    this.signUpLink = page.getByRole('link', { name: /sign up/i })
    this.browseCatalogButton = page.getByRole('link', { name: /browse product catalog/i })
    this.footerContactLink = page.getByRole('link', { name: /contact us/i })
  }

  async open(): Promise<void> {
    await this.goto(ROUTES.siteLanding)
    await this.waitForAppReady()
    await expect(this.signInLink).toBeVisible({ timeout: 60_000 })
  }
}
