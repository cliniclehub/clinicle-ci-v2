/** Shared routes and timeouts for UI system tests. */

import {
  getRoleBySlug,
  hasRoleCredentials,
  roleCredentialSkipMessage,
  roleCredentials,
} from './roles'

export { roleCredentialSkipMessage } from './roles'

export const DEFAULT_BASE_URL = 'https://testorg-a.clinicle-ci.local'

export const ROUTES = {
  home: '/',
  siteLanding: '/site-landing',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  contact: '/contact',
  privacyPolicy: '/privacy-policy',
  termsOfUse: '/terms-of-use',
  unauthorized: '/unauthorized',
  settings: '/settings',
  platformOrganizations: '/platform-organizations',
  organizationSettings: '/organization-settings',
  organizationUsers: '/organization-users',
} as const

export const TIMEOUTS = {
  appReady: 60_000,
  catalogLoad: 60_000,
  authRedirect: 30_000,
} as const

export function hasUserCredentials(): boolean {
  return hasRoleCredentials(getRoleBySlug('user'))
}

export function userCredentials(): { email: string; password: string } {
  return roleCredentials(getRoleBySlug('user'))
}

export function hasAdminCredentials(): boolean {
  return hasRoleCredentials(getRoleBySlug('org-admin'))
}

export function adminCredentials(): { email: string; password: string } {
  return roleCredentials(getRoleBySlug('org-admin'))
}

export function hasOrgAdminCredentials(): boolean {
  return hasAdminCredentials()
}

export function orgAdminCredentials(): { email: string; password: string } {
  return adminCredentials()
}
