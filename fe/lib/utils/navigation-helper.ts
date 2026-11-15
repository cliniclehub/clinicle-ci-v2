"use client"

import { RoleId } from "@/lib/types/role-schema"
import { getRoleLandingPage } from "./role-hierarchy"

export function getDefaultLandingPage(role?: RoleId | null): string {
  if (!role) {
    return "/dashboard"
  }

  return getRoleLandingPage(role)
}
