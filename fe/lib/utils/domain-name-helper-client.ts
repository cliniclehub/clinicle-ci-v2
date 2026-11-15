'use client'

/**
 * Client-side domain helper functions
 */

export function getDomainClient(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.location.hostname
}

export function getFullDomainClient(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.location.host
}

/**
 * Signup is enabled for all tenant hosts. Keep the helper so existing callers compile.
 */
export function isSignupDisabled(): boolean {
  return false
}
