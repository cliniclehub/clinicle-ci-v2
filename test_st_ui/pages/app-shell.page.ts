import { expect, type Locator, type Page } from '@playwright/test'

/** Sidebar profile menu for authenticated users. */
export class AppShellPage {
  readonly profileMenuRoot: Locator
  readonly profileTrigger: Locator
  readonly settingsButton: Locator
  readonly signOutButton: Locator

  constructor(page: Page) {
    this.profileMenuRoot = page.locator('[data-profile-menu="true"]')
    this.profileTrigger = this.profileMenuRoot.locator('button').first()
    this.settingsButton = this.profileMenuRoot.getByRole('button', { name: /^settings$/i })
    this.signOutButton = this.profileMenuRoot.getByRole('button', { name: /sign out/i })
  }

  async openProfileMenu(): Promise<void> {
    await this.profileTrigger.click()
    await expect(this.settingsButton).toBeVisible({ timeout: 15_000 })
  }

  async goToSettings(): Promise<void> {
    await this.openProfileMenu()
    await this.settingsButton.click()
  }

  async signOut(): Promise<void> {
    await this.openProfileMenu()
    await this.signOutButton.click()
  }
}
