import { test } from '../../support/fixtures'

test.describe('Auth pages @smoke', () => {
  test('login page renders sign-in form', async ({ loginPage }) => {
    await loginPage.open()
    await loginPage.expectOnPage()
  })

  test('register page renders registration form', async ({ registerPage }) => {
    await registerPage.open()
    await registerPage.expectOnPage()
  })

  test('forgot password page renders reset form', async ({ forgotPasswordPage }) => {
    await forgotPasswordPage.open()
    await forgotPasswordPage.expectOnPage()
  })
})
