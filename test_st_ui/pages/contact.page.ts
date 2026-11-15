import { expect, type Locator, type Page } from '@playwright/test'

import { ROUTES } from '../support/constants'
import { BasePage } from './base.page'

export type ContactFormData = {
  name: string
  email: string
  topic?: string
  subject: string
  message: string
}

export class ContactPage extends BasePage {
  readonly heading: Locator
  readonly nameInput: Locator
  readonly emailInput: Locator
  readonly topicSelect: Locator
  readonly subjectInput: Locator
  readonly messageInput: Locator
  readonly submitButton: Locator

  constructor(page: Page) {
    super(page)
    this.heading = page.getByRole('heading', { name: /contact us/i })
    this.nameInput = page.getByLabel(/your name/i)
    this.emailInput = page.getByLabel(/your email/i)
    this.topicSelect = page.getByRole('combobox', { name: /topic/i })
    this.subjectInput = page.getByLabel(/^subject$/i)
    this.messageInput = page.getByLabel(/^message$/i)
    this.submitButton = page.getByRole('button', { name: /send message/i })
  }

  async open(): Promise<void> {
    await this.goto(ROUTES.contact)
    await this.waitForAppReady()
    await expect(this.heading).toBeVisible({ timeout: 60_000 })
  }

  async canSubmit(): Promise<boolean> {
    return !(await this.submitButton.isDisabled())
  }

  async fillForm(data: ContactFormData): Promise<void> {
    await this.nameInput.fill(data.name)
    await this.emailInput.fill(data.email)
    if (data.topic) {
      await this.topicSelect.click()
      await this.page.getByRole('option', { name: new RegExp(data.topic, 'i') }).click()
    }
    await this.subjectInput.fill(data.subject)
    await this.messageInput.fill(data.message)

    await expect(this.nameInput).toHaveValue(data.name)
    await expect(this.emailInput).toHaveValue(data.email)
    await expect(this.subjectInput).toHaveValue(data.subject)
    await expect(this.messageInput).toHaveValue(data.message)
  }

  async submit(): Promise<void> {
    await this.submitButton.click()
  }

  /** Submit via server action and assert Sonner success toast. */
  async submitAndExpectSuccess(): Promise<void> {
    await expect(this.nameInput).not.toHaveValue('')
    await expect(this.messageInput).not.toHaveValue('')

    const actionPromise = this.page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname.endsWith('/contact'),
      { timeout: 30_000 },
    )

    await this.submitButton.click()
    await actionPromise

    await expect(
      this.page.getByText(/message sent successfully|your message has been sent/i),
    ).toBeVisible({ timeout: 10_000 })
  }
}
