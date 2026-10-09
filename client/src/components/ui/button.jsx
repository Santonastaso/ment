import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils"

const quietButton = "bg-[var(--control-surface)] text-foreground hover:bg-[var(--control-surface-hover)] aria-expanded:bg-[var(--control-surface-hover)] aria-expanded:text-foreground";
const primaryButton = "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-200 ease-out outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: primaryButton,
        outline: quietButton,
        ghost: quietButton,
        danger: `${quietButton} text-destructive hover:text-destructive`,
        secondary: primaryButton,
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // One radius (pill) and one three-step scale everywhere: sm for dense
      // tables, default 44px aligned to input height, lg for page-level CTAs.
      size: {
        default:
          "h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        // Three heights only: 32 (xs), 36 (sm), 44 (default / lg). Icons are 16px.
        xs: "h-8 gap-1 px-3 text-xs",
        sm: "h-9 gap-1 px-4 text-sm",
        lg: "h-11 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-9",
        "icon-xs": "size-8",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = forwardRef(function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}, ref) {
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props} />
  );
});

export { Button, buttonVariants }
