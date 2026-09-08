import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-[var(--panel-radius)] border border-transparent bg-[var(--control-surface)] px-4 py-3 text-[15px] leading-relaxed transition-colors duration-100 outline-none placeholder:text-[#969088] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20",
        className
      )}
      {...props} />
  );
}

export { Textarea }
