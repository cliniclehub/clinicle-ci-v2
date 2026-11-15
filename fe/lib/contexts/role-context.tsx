"use client"

import { useAuth } from "@/lib/contexts/auth-context"
import type { RoleId } from "@/lib/types/role-schema"
import {
  getHighestPriorityRole,
  getManagementRoles,
  hasManagementRoles,
  normalizeRole,
} from "@/lib/utils/role-hierarchy"
import { createClientLogger } from "@/lib/utils/logger-client"
import React, { createContext, useContext, useEffect, useState } from "react"

const roleLogger = createClientLogger("RoleProvider")

interface RoleContextType {
  roles: RoleId[]
  activeRole: RoleId | null
  setActiveRole: (role: RoleId) => void
  hasManagementRoles: boolean
  managementRoles: RoleId[]
  permissions: string[]
  isLoading: boolean
}

const RoleContext = createContext<RoleContextType>({
  roles: [],
  activeRole: null,
  setActiveRole: () => {},
  hasManagementRoles: false,
  managementRoles: [],
  permissions: [],
  isLoading: true,
})

export const RoleProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [roles, setRoles] = useState<RoleId[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [activeRole, setActiveRole] = useState<RoleId | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const handleSetActiveRole = (role: RoleId) => {
    setActiveRole(role)
    localStorage.setItem("activeRole", role)
  }

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!isAuthenticated || !user) {
      setRoles([])
      setPermissions([])
      setActiveRole(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const convertedRoles = (user.roles ?? []).map((role) => normalizeRole(role)) as RoleId[]
      setRoles(convertedRoles)
      setPermissions(user.permissions ?? [])

      const savedRole = localStorage.getItem("activeRole") as RoleId | null
      if (savedRole && convertedRoles.includes(savedRole)) {
        setActiveRole(savedRole)
      } else {
        const highestPriorityRole = getHighestPriorityRole(convertedRoles)
        setActiveRole(highestPriorityRole)
        if (highestPriorityRole) {
          localStorage.setItem("activeRole", highestPriorityRole)
        }
      }
    } catch (error) {
      roleLogger.error("Failed to load user roles", error as Error)
    } finally {
      setIsLoading(false)
    }
  }, [isAuthenticated, authLoading, user])

  const contextValue: RoleContextType = {
    roles,
    activeRole,
    setActiveRole: handleSetActiveRole,
    hasManagementRoles: hasManagementRoles(roles) || permissions.some((p) => p.startsWith("org.") || p.startsWith("platform.")),
    managementRoles: getManagementRoles(roles),
    permissions,
    isLoading,
  }

  return (
    <RoleContext.Provider value={contextValue}>
      {children}
    </RoleContext.Provider>
  )
}

export const useRoles = () => useContext(RoleContext)
