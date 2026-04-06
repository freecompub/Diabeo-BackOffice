/**
 * Pure parsing functions for BDPM data.
 *
 * Extracted from bdpm.service.ts for testability — no Prisma/DB dependency.
 * These functions handle TSV parsing, date/price format conversion.
 */

/**
 * Parse tab-separated content into a 2D string array.
 * Skips empty lines, trims whitespace from each field.
 */
export function parseTsv(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((field) => field.trim()))
}

/**
 * Parse a date string in DD/MM/YYYY or YYYY-MM-DD format.
 * Returns null for invalid or empty input.
 */
export function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split("/")
  if (parts.length === 3) {
    const [day, month, year] = parts
    const d = new Date(`${year}-${month}-${day}`)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Parse a price string in French or standard format.
 * Handles: "12,50", "12.50", "1.234,56", "12,50 €"
 * Returns null for invalid or empty input.
 */
export function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null
  let cleaned = priceStr.replace(/[^\d.,]/g, "")
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".")
  }
  const price = parseFloat(cleaned)
  return Number.isFinite(price) ? price : null
}
