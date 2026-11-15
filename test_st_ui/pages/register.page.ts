import { expect, type Locator, type Page } from '@playwright/test'

import { ROUTES } from '../support/constants'
import { BasePage } from './base.page'

export class RegisterPage extends BasePage {
  readonly heading: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly signInLink: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByRole('heading', { level: 2, name: /create your account/i })
    this.emailInput = page.getByLabel(/^email$/i)
    this.passwordInput = page.getByLabel(/^password$/i).first()
    this.submitButton = page.getByRole('button', { name: /create account/i })
    this.signInLink = page.getByRole('link', { name: /sign in/i })
  }

  async open(): Promise<void> {
    await this.goto(ROUTES.register)
    await expect(this.heading).toBeVisible({ timeout: 60_000 })
  }

  async expectOnPage(): Promise<void> {
    await expect(this.heading).toBeVisible()
    await expect(this.emailInput).toBeVisible()
    await expect(this.submitButton).toBeVisible()
  }
}
