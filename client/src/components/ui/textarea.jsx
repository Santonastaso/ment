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
        "flex field-sizing-content min-h-20 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-[15px] leading-relaxed transition-colors duration-150 ease-out outline-none placeholder:text-[#aaa49b] focus-visible:border-[#d97757] focus-visible:ring-[3px] focus-visible:ring-[#d97757]/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props} />
  );
}

export { Textarea }
