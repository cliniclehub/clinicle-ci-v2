import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-white/15 bg-[color:var(--primary-color)] text-white shadow-sm shadow-black/15 hover:bg-[color:var(--accent-color)] hover:shadow-md hover:shadow-black/15",
        destructive:
          "border border-white/15 bg-destructive text-destructive-foreground shadow-sm shadow-destructive/25 hover:bg-destructive/90 hover:shadow-md hover:shadow-destructive/25",
        outline:
          "border border-[color:var(--primary-color)]/60 bg-background/80 text-[color:var(--primary-color)] shadow-sm backdrop-blur-sm hover:bg-[color:var(--primary-color)] hover:text-white hover:shadow-md",
        /** Same shape as outline but neutral (forms / combobox triggers — not branded like a CTA) */
        outlineNeutral:
          "border border-input/80 bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-accent-foreground hover:shadow-md",
        secondary:
          "border border-border/50 bg-secondary/90 text-secondary-foreground shadow-sm backdrop-blur-sm hover:bg-secondary/80 hover:shadow-md",
        ghost:
          "shadow-none hover:bg-accent/80 hover:text-accent-foreground hover:shadow-sm",
        link:
          "text-[color:var(--primary-color)] shadow-none underline-offset-4 hover:translate-y-0 hover:underline",
        // Custom variant with subtle hover using primary color
        subtle:
          "border border-white/15 bg-[color:var(--primary-color)] text-white shadow-sm shadow-black/10 hover:bg-[color:var(--primary-color)]/80 hover:shadow-md",
        // Custom outline variant that uses primary color for hover
        outlinePrimary:
          "border border-[color:var(--primary-color)]/60 bg-background/80 text-[color:var(--primary-color)] shadow-sm backdrop-blur-sm hover:bg-[color:var(--primary-color)] hover:text-white hover:shadow-md",
        // Custom ghost variant that uses primary color for hover
        ghostPrimary:
          "text-[color:var(--primary-color)] shadow-none hover:bg-[color:var(--primary-color)]/10 hover:shadow-sm",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
