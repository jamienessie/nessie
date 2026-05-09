import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border-[1.5px] border-[#0d0c10] px-2 py-0.5 text-[10px] font-extrabold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-[#0d0c10] focus-visible:ring-[#0d0c10]/50 focus-visible:ring-[2px] aria-invalid:ring-[#FF4D2E]/20 aria-invalid:border-[#FF4D2E] transition-[color,box-shadow] overflow-hidden font-mono uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-[#0d0c10] text-[#fffaf0] [a&]:hover:bg-[#0d0c10]/90",
        secondary:
          "bg-[#FFF8E8] text-[#0d0c10] [a&]:hover:bg-[#FFF1B8]",
        destructive:
          "bg-[#FF4D2E] text-[#fffaf0] [a&]:hover:bg-[#FF4D2E]/90",
        outline:
          "bg-transparent text-[#0d0c10] [a&]:hover:bg-[#FFF1B8]",
        ghost: "border-transparent [a&]:hover:bg-[#FFF1B8] [a&]:hover:text-[#0d0c10]",
        link: "border-transparent text-[#0d0c10] underline-offset-4 [a&]:hover:underline",
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
