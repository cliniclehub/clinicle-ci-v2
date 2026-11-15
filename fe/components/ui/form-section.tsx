"use client"

import { cn } from "@/lib/utils/cn"
import { ReactNode } from "react"

interface FormSectionProps {
  id: string
  title: string
  description?: string
  children: ReactNode
  className?: string
  isDirty?: boolean
}

export function FormSection({
  id,
  title,
  description,
  children,
  className,
  isDirty = false,
}: FormSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "space-y-6 scroll-mt-8",
        className
      )}
    >
      <div className="space-y-1">
        <h3 className="text-lg font-medium">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  )
}