"use client";

/**
 * PeriodSelector — US-WEB-102
 *
 * Horizontal set of selectable period buttons allowing the user to switch
 * between predefined time windows (1W, 2W, 1M, 3M) for clinical data views
 * such as CGM charts and glycemia analytics.
 *
 * Accessibility:
 *   - ARIA tablist/tab pattern so screen readers announce it as a tab group.
 *   - Keyboard: Tab to focus the group, arrow keys are not required by the
 *     spec; Enter/Space activate the focused button.
 *   - Each button carries aria-selected to communicate selection state.
 *
 * RTL:
 *   - Flexbox row direction is reversed automatically by the browser in RTL
 *     documents. No explicit CSS logical properties are needed here because
 *     the container relies on flex layout which is direction-aware.
 *
 * Responsive:
 *   - overflow-x-auto ensures the row scrolls horizontally on narrow screens
 *     rather than wrapping or clipping.
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

export enum TimePeriod {
  OneWeek = "1W",
  TwoWeeks = "2W",
  OneMonth = "1M",
  ThreeMonths = "3M",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeriodSelectorProps {
  /** Currently active period. */
  selectedPeriod: TimePeriod;
  /** Called when the user selects a different period. */
  onPeriodSelected: (period: TimePeriod) => void;
  /** Optional extra Tailwind classes applied to the outermost element. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Ordered list of periods rendered left-to-right (RTL-safe via flexbox). */
const PERIODS: Array<{ value: TimePeriod; labelKey: string }> = [
  { value: TimePeriod.OneWeek, labelKey: "oneWeek" },
  { value: TimePeriod.TwoWeeks, labelKey: "twoWeeks" },
  { value: TimePeriod.OneMonth, labelKey: "oneMonth" },
  { value: TimePeriod.ThreeMonths, labelKey: "threeMonths" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PeriodSelector renders a horizontal pill-style tab group for choosing a
 * time period. It is a purely controlled component — all state lives in the
 * parent via `selectedPeriod` / `onPeriodSelected`.
 *
 * @example
 * ```tsx
 * const [period, setPeriod] = useState(TimePeriod.OneMonth);
 * <PeriodSelector selectedPeriod={period} onPeriodSelected={setPeriod} />
 * ```
 */
export function PeriodSelector({
  selectedPeriod,
  onPeriodSelected,
  className,
}: PeriodSelectorProps) {
  const t = useTranslations("period");

  return (
    <div
      role="tablist"
      aria-label={t("oneWeek") /* outermost label — aria-label on tablist */}
      className={cn(
        // Horizontal scroll container — prevents overflow on small screens
        "flex flex-row gap-1 overflow-x-auto",
        // Remove default scrollbar on WebKit while keeping it functional
        "scrollbar-none",
        className
      )}
    >
      {PERIODS.map(({ value, labelKey }) => {
        const isSelected = value === selectedPeriod;

        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            // tabIndex 0 on all tabs so the user can Tab through each one
            tabIndex={0}
            onClick={() => onPeriodSelected(value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPeriodSelected(value);
              }
            }}
            className={cn(
              // Base styles — size, font, cursor, no text wrapping
              "inline-flex items-center justify-center",
              "min-w-[2.75rem] px-3 py-1.5",
              "text-sm font-medium whitespace-nowrap",
              "rounded-full cursor-pointer",
              "outline-none",
              // Transition — 200ms matching --diabeo-duration-normal
              "transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
              // Focus ring — visible for keyboard navigation (WCAG 2.1 §2.4.7)
              "focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1",
              // Selected vs unselected visual states
              isSelected
                ? "bg-teal-600 text-white"
                : "bg-transparent text-gray-600 hover:bg-teal-50"
            )}
          >
            {t(labelKey as Parameters<typeof t>[0])}
          </button>
        );
      })}
    </div>
  );
}
