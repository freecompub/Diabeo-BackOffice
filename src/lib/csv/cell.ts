/**
 * @module csv/cell
 * @description CSV cell escaping with defense-in-depth against formula
 * injection (CVE-2014-3524 family).
 *
 * Rules applied (in order):
 * 1. null/undefined → empty cell
 * 2. value starting with `=`, `+`, `-`, `@`, tab or CR → prefix with `'`
 *    so Excel/LibreOffice treats it as literal text and refuses to evaluate
 *    a formula.
 * 3. value containing `,`, `"`, newline, CR, or `;` → wrap in double-quotes
 *    and double-up embedded `"`.
 *
 * Centralized so route + tests can import the SAME implementation and never
 * drift on the escape rules.
 */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  let str = String(value)
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str
  if (/[",\n\r;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}
