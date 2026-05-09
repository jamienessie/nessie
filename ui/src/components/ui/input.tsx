import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-[#0d0c10] placeholder:text-[#5a525e] selection:bg-[#0d0c10] selection:text-[#fffaf0] bg-[#fffaf0] border-[#0d0c10] h-9 w-full min-w-0 border-[2px] px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-bold disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm font-semibold",
        "focus-visible:border-[#0d0c10] focus-visible:ring-[#0d0c10]/50 focus-visible:ring-[2px]",
        "aria-invalid:ring-[#FF4D2E]/20 aria-invalid:border-[#FF4D2E]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
