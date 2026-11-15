import { expect, type Locator, type Page } from '@playwright/test'

import { ROUTES } from '../support/constants'
import { BasePage } from './base.page'

export class LoginPage extends BasePage {
  readonly heading: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly registerLink: Locator
  readonly forgotPasswordLink: Locator
  readonly errorAlert: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByRole('heading', { level: 2, name: /sign in to your account/i })
    this.emailInput = page.getByLabel('Email', { exact: true })
    this.passwordInput = page.locator('input#password')
    this.submitButton = page.getByRole('button', { name: /^sign in$/i })
    this.registerLink = page.getByRole('link', { name: /sign up|create account|register/i })
    this.forgotPasswordLink = page.getByRole('link', { name: /forgot password/i })
    // Exclude Next.js route announcer which also uses role="alert".
    this.errorAlert = page.getByRole('alert').filter({ hasText: /.+/ })
  }

  async open(): Promise<void> {
    await this.goto(ROUTES.login)
    await this.waitForAppReady()
    await expect(this.heading).toBeVisible()
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.waitForAppReady()
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async expectOnPage(): Promise<void> {
    await this.waitForAppReady()
    await expect(this.heading).toBeVisible()
    await expect(this.emailInput).toBeVisible()
    await expect(this.passwordInput).toBeVisible()
    await expect(this.submitButton).toBeVisible()
  }
}
