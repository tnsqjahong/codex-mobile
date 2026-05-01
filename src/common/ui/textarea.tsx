import * as React from "react"

import { cn } from "@/common/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[64px] w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-warm)] px-2.5 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted-text-soft)] focus-visible:outline-none focus-visible:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
