"use client"

/**
 * Chart display options toggle menu.
 * Controls visibility of insulin doses, events, and threshold zones.
 */

import { Settings2 } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ChartDisplayOptions } from "./types"

interface ChartDisplayOptionsMenuProps {
  options: ChartDisplayOptions
  onChange: (options: ChartDisplayOptions) => void
}

export function ChartDisplayOptionsMenu({
  options,
  onChange,
}: ChartDisplayOptionsMenuProps) {
  const t = useTranslations("chart")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Display options"
      >
        <Settings2 className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem
          checked={options.showInsulin}
          onCheckedChange={(checked) =>
            onChange({ ...options, showInsulin: checked === true })
          }
        >
          {t("showInsulin")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={options.showEvents}
          onCheckedChange={(checked) =>
            onChange({ ...options, showEvents: checked === true })
          }
        >
          {t("showEvents")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={options.showThresholds}
          onCheckedChange={(checked) =>
            onChange({ ...options, showThresholds: checked === true })
          }
        >
          {t("showThresholds")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
