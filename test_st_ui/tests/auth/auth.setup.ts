import path from 'path'

import { test as setup } from '@playwright/test'

import { saveAuthSession } from '../../support/auth-setup'
import {
  appRoleIdForSlug,
  authFileForRole,
  ST_ROLES,
  hasRoleCredentials,
  roleCredentialSkipMessage,
  roleCredentials,
  stSuperAdminBaseUrl,
} from '../../support/roles'

const authDir = path.join(__dirname, '../../.auth')

for (const role of ST_ROLES) {
  setup(role.setupTitle, async ({ page }) => {
    setup.skip(!hasRoleCredentials(role), roleCredentialSkipMessage(role))

    const { email, password } = roleCredentials(role)
    const loginBaseUrl =
      role.slug === 'super-admin'
        ? stSuperAdminBaseUrl() ?? 'https://admin.clinicle-ci.local'
        : undefined

    await saveAuthSession(page, email, password, authFileForRole(role.slug, authDir), {
      appRoleId: appRoleIdForSlug(role.slug),
      loginBaseUrl,
    })
  })
}
