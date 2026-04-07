/**
 * Time slot overlap detection utilities.
 *
 * Extracted from insulin-therapy.service.ts for testability without
 * Prisma dependency. Used by createIsf/createIcr to prevent overlapping
 * insulin delivery slots — a critical patient safety feature.
 */

/**
 * Check if a new time slot overlaps with any existing slots.
 * Supports midnight crossing (e.g., 22h → 6h).
 *
 * @param existing - Array of existing slots with startHour/endHour
 * @param newStart - New slot start hour (0-23)
 * @param newEnd - New slot end hour (0-23)
 * @returns true if there is any overlap
 */
export function hasTimeSlotOverlap(
  existing: Array<{ startHour: number; endHour: number }>,
  newStart: number,
  newEnd: number,
): boolean {
  for (const slot of existing) {
    if (hoursOverlap(slot.startHour, slot.endHour, newStart, newEnd)) {
      return true
    }
  }
  return false
}

function hoursOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean {
  const setA = expandHours(aStart, aEnd)
  const setB = expandHours(bStart, bEnd)
  return setA.some((h) => setB.includes(h))
}

export function expandHours(start: number, end: number): number[] {
  const hours: number[] = []
  if (start <= end) {
    for (let h = start; h < end; h++) hours.push(h)
  } else {
    // Midnight crossing: 22→6 = [22,23,0,1,2,3,4,5]
    for (let h = start; h < 24; h++) hours.push(h)
    for (let h = 0; h < end; h++) hours.push(h)
  }
  return hours
}
