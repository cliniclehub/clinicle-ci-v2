"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      expand={true}
      richColors={true}
      duration={4000}
      closeButton={true}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-blue-600 group-[.toast]:text-white hover:group-[.toast]:bg-blue-700",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-foreground hover:group-[.toast]:bg-muted/80",
          success: "group-[.toast]:bg-green-500 group-[.toast]:text-white group-[.toast]:border-green-600",
          error: "group-[.toast]:bg-red-500 group-[.toast]:text-white group-[.toast]:border-red-600",
          warning: "group-[.toast]:bg-yellow-500 group-[.toast]:text-white group-[.toast]:border-yellow-600",
          info: "group-[.toast]:bg-blue-500 group-[.toast]:text-white group-[.toast]:border-blue-600",
        },
        duration: 4000,
      }}
      {...props}
    />
  )
}

export { Toaster }
