/**
 * Composed seed scenarios for the remaining baseline domains (org + users).
 */

import { createSeedContext, SeedContext } from './builders/context'
import { createOrgUser, registerUser, SeededUser } from './builders/users'

export interface Scenarios {
  ctx: SeedContext
  freshUser(label?: string): Promise<SeededUser>
  registeredUser(label?: string): Promise<SeededUser>
}

export function scenarios(ctx: SeedContext = createSeedContext()): Scenarios {
  return {
    ctx,
    freshUser: (label = 'user') => createOrgUser(ctx, { roles: ['user'], label }),
    registeredUser: (label = 'registered') => registerUser(ctx, { label }),
  }
}
