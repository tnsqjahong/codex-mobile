import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/common/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--canvas-soft)] text-[var(--ink)]",
        secondary: "border-transparent bg-[var(--canvas-soft)] text-[var(--ink)]",
        destructive: "border-transparent bg-[var(--status-error)] text-white",
        outline: "border-[var(--hairline)] bg-transparent text-[var(--muted-text)]",
        ghost: "[a&]:hover:bg-[var(--row-hover)] [a&]:hover:text-[var(--ink-strong)]",
        link: "text-[var(--primary)] underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
