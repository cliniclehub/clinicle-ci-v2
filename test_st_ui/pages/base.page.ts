import type { Page } from '@playwright/test'

/** Base page object — shared navigation helpers. */
export class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' })
  }

  async waitForAppReady(): Promise<void> {
    const loader = this.page.getByText('Loading theme...')
    const visible = await loader.isVisible().catch(() => false)
    if (visible) {
      const hidden = await loader.waitFor({ state: 'hidden', timeout: 30_000 })
        .then(() => true)
        .catch(() => false)
      if (!hidden) {
        await this.page.reload()
        await loader.waitFor({ state: 'hidden', timeout: 60_000 })
      }
    }
  }
}
