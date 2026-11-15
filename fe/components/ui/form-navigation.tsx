"use client"

import { cn } from "@/lib/utils/cn"
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"

export interface FormNavigationItem {
  id: string
  label: string
  isDirty?: boolean
  isValid?: boolean
}

interface FormNavigationProps {
  items: FormNavigationItem[]
  activeSection: string
  onSectionChange: (sectionId: string) => void
  className?: string
  orientation?: "vertical" | "horizontal"
}

export function FormNavigation({
  items,
  activeSection,
  onSectionChange,
  className,
  orientation = "vertical",
}: FormNavigationProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  if (orientation === "horizontal") {
    return (
      <nav className={cn("min-w-0 overflow-hidden border-b", className)}>
        <div className="-mx-1 flex space-x-6 overflow-x-auto pb-px md:space-x-8">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 py-2 text-sm font-medium transition-colors",
                activeSection === item.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
              {item.isDirty && (
                <span className="text-xs text-destructive">●</span>
              )}
              {item.isValid === false && (
                <span className="text-xs text-destructive">!</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    )
  }

  return (
    <nav className={cn("space-y-1", className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSectionChange(item.id)}
          className={cn(
            "group flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            activeSection === item.id
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2">
            {item.label}
            {item.isDirty && (
              <span className="text-xs text-destructive">●</span>
            )}
            {item.isValid === false && (
              <span className="text-xs text-destructive">!</span>
            )}
          </span>
          <ChevronRight
            className={cn(
              "h-4 w-4 opacity-0 transition-opacity",
              activeSection === item.id && "opacity-100"
            )}
          />
        </button>
      ))}
    </nav>
  )
}