import * as React from "react"

import { cn } from "@/common/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-warm)] px-2.5 py-1.5 text-sm text-[var(--ink)] placeholder:text-[var(--muted-text-soft)] focus-visible:outline-none focus-visible:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
