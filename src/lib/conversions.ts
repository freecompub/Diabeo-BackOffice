/**
 * @module conversions
 * @description Glucose unit conversions — all data stored in g/L internally.
 * Reference: 1 g/L = 100 mg/dL = 5.5506 mmol/L
 * Molar mass glucose = 180.156 g/mol → 1000/180.156 ≈ 5.5506 mmol/L
 * Used in UI display and user input conversion (from/to g/L).
 */

/**
 * Glucose unit conversion table — maps units to from/to g/L converters.
 * @constant
 * @type {Object<string, {from: Function, to: Function}>}
 */
export const GLUCOSE_CONVERSIONS = {
  "g/L": {
    from: (v: number) => v,
    to: (v: number) => v,
  },
  "mg/dL": {
    from: (v: number) => v / 100,
    to: (v: number) => v * 100,
  },
  "mmol/L": {
    from: (v: number) => v / 5.5506,
    to: (v: number) => v * 5.5506,
  },
} as const

/**
 * Glucose unit type — union of supported units.
 * @typedef {("g/L" | "mg/dL" | "mmol/L")} GlucoseUnit
 */
export type GlucoseUnit = keyof typeof GLUCOSE_CONVERSIONS

/**
 * Convert glucose value from g/L (internal) to target unit.
 * Used in API response formatting (user-preferred units).
 * @param {number} value - Glucose in g/L
 * @param {GlucoseUnit} targetUnit - Target unit (g/L, mg/dL, or mmol/L)
 * @returns {number} Converted value
 * @example
 * convertGlucoseFromGl(1.50, "mg/dL") // Returns 150
 * convertGlucoseFromGl(1.50, "mmol/L") // Returns 8.33
 */
export function convertGlucoseFromGl(value: number, targetUnit: GlucoseUnit): number {
  return GLUCOSE_CONVERSIONS[targetUnit].to(value)
}

/**
 * Convert glucose value from source unit to g/L (internal storage).
 * Used in API request parsing (user-provided units → g/L).
 * @param {number} value - Glucose in source unit
 * @param {GlucoseUnit} sourceUnit - Source unit (g/L, mg/dL, or mmol/L)
 * @returns {number} Glucose in g/L
 * @example
 * convertGlucoseToGl(150, "mg/dL") // Returns 1.50
 * convertGlucoseToGl(8.33, "mmol/L") // Returns 1.50
 */
export function convertGlucoseToGl(value: number, sourceUnit: GlucoseUnit): number {
  return GLUCOSE_CONVERSIONS[sourceUnit].from(value)
}

/**
 * Unit definitions reference table — matches database seed data.
 * Used to populate unit selection dropdowns and for formatting.
 * @constant
 * @type {Array<{code: number, name: string, category: string, label: string}>}
 */
export const UNIT_DEFINITIONS = [
  { code: 1, name: "CP", category: "carb", label: "Portions" },
  { code: 2, name: "g", category: "carb", label: "Grammes" },
  { code: 3, name: "g/L", category: "glycemia", label: "g/L" },
  { code: 4, name: "mg/dL", category: "glycemia", label: "mg/dL" },
  { code: 5, name: "mmol/L", category: "glycemia", label: "mmol/L" },
  { code: 6, name: "kg", category: "weight", label: "Kilogrammes" },
  { code: 7, name: "lbs", category: "weight", label: "Livres" },
  { code: 8, name: "cm", category: "size", label: "Centimètres" },
  { code: 9, name: "ft", category: "size", label: "Pieds" },
  { code: 10, name: "%", category: "hba1c", label: "% NGSP" },
  { code: 11, name: "mmol/mol", category: "hba1c", label: "mmol/mol IFCC" },
  { code: 12, name: "mmol/L", category: "ketones", label: "mmol/L" },
  { code: 13, name: "mg/dL", category: "ketones", label: "mg/dL" },
  { code: 14, name: "mmHg", category: "blood_pressure", label: "mmHg" },
  { code: 15, name: "g/échange", category: "carb_exchange", label: "g/échange" },
] as const
