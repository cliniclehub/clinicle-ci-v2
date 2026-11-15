"use client"

import { useRoles } from "@/lib/contexts/role-context"
import { getRoleLabel, type RoleId } from "@/lib/types/role-schema"
import { getRoleLandingPage } from "@/lib/utils/role-hierarchy"
import { ChevronDown, UserIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

export function RoleDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const { roles, activeRole, setActiveRole } = useRoles()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Close dropdown when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsOpen(false)
    }
  }

  // Add click outside listener
  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Don't render if user has no roles or only one role
  if (!roles.length || roles.length <= 1) return null;

  const handleRoleChange = (newRole: RoleId) => {
    setActiveRole(newRole)
    setIsOpen(false)
    
    // Navigate to the appropriate landing page for the new role
    const landingPage = getRoleLandingPage(newRole)
    // Use setTimeout to ensure dropdown closes before navigation
    // Use router.replace to avoid adding to history and ensure navigation happens
    setTimeout(() => {
      router.replace(landingPage)
    }, 100)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-md shadow-sm hover:bg-muted transition-colors"
      >
        <UserIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium dark:text-white">
          {activeRole ? getRoleLabel(activeRole) : "Select Role"}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 w-48 bg-card border border-border rounded-md shadow-lg z-50">
          <div className="py-1">
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => handleRoleChange(role)}
                className={`w-full text-left px-4 py-2 text-sm ${
                  role === activeRole
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                {getRoleLabel(role)}
                {role === activeRole && (
                  <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">(Active)</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
