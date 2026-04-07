"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

interface WidgetSkeletonProps {
  /** Additional CSS classes */
  className?: string
}

/**
 * Loading skeleton for a single metric widget.
 *
 * Matches the visual footprint of the real widget (title line + value block)
 * so the layout does not shift when data arrives.
 */
export function WidgetSkeleton({ className }: WidgetSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Chargement du widget"
      className={cn("rounded-lg bg-white p-4 shadow-sm", className)}
    >
      {/* Title placeholder */}
      <Skeleton className="h-3 w-24 mb-3" />
      {/* Value placeholder */}
      <Skeleton className="h-8 w-20 mb-1" />
      {/* Sub-label placeholder */}
      <Skeleton className="h-3 w-16" />
    </div>
  )
}
