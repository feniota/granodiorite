import { cn } from "@/lib/utils"
import { RiLoaderLine } from "@remixicon/react"

type SpinnerProps = {
  className?: string
  role?: string
  "aria-label"?: string
}

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <RiLoaderLine data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
