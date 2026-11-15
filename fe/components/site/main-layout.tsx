"use client"

import { Sidebar } from "@/components/site/sidebar"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"

interface MainLayoutProps {
  children: React.ReactNode
  org?: {
    name?: string
    logoUrl?: string
    privacyNotice?: string
    headlineText?: string
    [key: string]: any
  }
}

export function MainLayout({ children, org }: MainLayoutProps) {
  // Initialize sidebar state from localStorage, default to false
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebarOpen')
      return saved === 'true'
    }
    return false
  })
  const [isMobile, setIsMobile] = useState(false)

  // Persist sidebar state to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarOpen', sidebarOpen.toString())
    }
  }, [sidebarOpen])

  // Check if we're on mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      // Keep sidebar closed on mobile
      if (window.innerWidth < 768) {
        setSidebarOpen(false)
      } else {
        // On desktop, restore from localStorage if not already set
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem('sidebarOpen')
          if (saved !== null) {
            setSidebarOpen(saved === 'true')
          }
        }
      }
    }

    // Initial check
    checkMobile()

    // Add event listener for window resize
    window.addEventListener("resize", checkMobile)

    // Cleanup
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  return (
    <div className={`${isMobile ? 'min-h-screen' : 'fixed inset-0'} bg-background`}>
      {/* Main content area with integrated sidebar */}
      <div className={`${isMobile ? 'relative min-h-screen' : 'flex h-full'}`}>
        {/* Collapsible Sidebar with integrated header features */}
        <Sidebar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          isMobile={isMobile}
          org={org}
        />
        {/* Main content area */}
        <main className={`${isMobile ? 'w-full min-h-screen' : 'flex-1'} min-w-0 overflow-x-hidden overflow-y-auto`}>
          {/* Mobile hamburger menu button - only visible on mobile when sidebar is closed */}
          {isMobile && !sidebarOpen && (
            <div className="sticky top-0 z-30 bg-background border-b border-border p-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 p-0"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          )}
          {/* overflow-x-clip (not hidden): clips horizontal overflow without creating a
              scroll container that breaks position:sticky in page sidebars. */}
          <div className="p-2 sm:p-3 min-w-0 max-w-full overflow-x-clip">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
