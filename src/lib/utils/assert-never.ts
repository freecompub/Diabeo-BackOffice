/**
 * @module assert-never
 * @description Exhaustiveness-check helper for discriminated unions and enums.
 * Placing `assertNever(x)` in a `default:` branch makes TypeScript fail compilation
 * when a new variant is added — the new value is no longer assignable to `never`.
 */

export function assertNever(x: never, msg?: string): never {
  throw new Error(msg ?? `Unhandled variant: ${String(x)}`)
}
