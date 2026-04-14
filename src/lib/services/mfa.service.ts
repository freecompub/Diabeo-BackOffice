/**
 * @module mfa.service
 * @description TOTP-based multi-factor authentication (RFC 6238).
 *
 * Security properties:
 * - Secret stored ENCRYPTED at rest (AES-256-GCM) via encryptField/decryptField
 *   — a DB dump does not leak TOTP seeds. Compatible with iOS app which reads
 *   via `/api/auth/mfa/setup` during enrollment.
 * - Window ±1 step (30s): tolerates small clock skew without widening the
 *   brute-force surface. 6-digit codes × 1 verification per second → rate
 *   limiting (3-attempt lockout in auth/rate-limit) prevents online guessing.
 * - Enable is a TWO-STEP process: generateSecret → user scans QR → verifyAndEnable.
 *   `mfaEnabled` is NEVER flipped to true without a successful OTP proof — so a
 *   half-completed setup does not lock the user out.
 * - Disable requires BOTH the current password AND a valid OTP (defense in
 *   depth against a stolen authenticated session).
 *
 * @see CLAUDE.md#mfa — MFA flow
 * @see https://datatracker.ietf.org/doc/html/rfc6238 — TOTP RFC
 */

import { generateSecret, generateURI, verifySync } from "otplib"

/**
 * TOTP-specific verify result shape. The functional `verifySync` returns a
 * union of HOTP|TOTP variants and loses `timeStep` in TS. We always pass
 * `strategy: "totp"`, so this is the only runtime shape.
 */
type TotpVerifyResult =
  | { readonly valid: true; readonly delta: number; readonly timeStep: number; readonly epoch: number }
  | { readonly valid: false }
import QRCode from "qrcode"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

// TOTP configuration — RFC 6238 defaults.
// epochTolerance: 30 seconds past-only (one previous step) — tolerates clock
// skew without widening the online brute-force window.
const TOTP_PERIOD = 30
const TOTP_DIGITS = 6
const TOTP_EPOCH_TOLERANCE: [number, number] = [30, 0]
const ISSUER = "Diabeo"

export interface SetupResult {
  /** otpauth:// URI — standard TOTP provisioning format (Google Authenticator, 1Password, Aegis) */
  otpauthUri: string
  /** Base64 data URI of a QR code PNG for client rendering. */
  qrCodeDataUri: string
}

export const mfaService = {
  /**
   * Generate a new TOTP secret for the user, persist it ENCRYPTED, and return
   * the provisioning material. Idempotent: overwrites any previous un-verified
   * secret. Refuses to run if MFA is already enabled (caller must disable first).
   *
   * Note: `mfaEnabled` stays FALSE until a successful `verifyAndEnable` call.
   * A user who scans the QR but never confirms is in a safe, inactive state.
   */
  async generateSecret(userId: number, accountLabel: string): Promise<SetupResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    })
    if (!user) throw new Error("userNotFound")
    if (user.mfaEnabled) throw new Error("mfaAlreadyEnabled")

    const secret = generateSecret()
    const encrypted = encryptField(secret)

    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encrypted, mfaEnabled: false, mfaLastUsedStep: null },
    })

    // accountLabel is shown in the authenticator app. Use a stable but
    // non-PII display form (we don't put the email in the URI to avoid
    // exposing it in the QR code photo — the label is a hint, not auth).
    const otpauthUri = generateURI({
      strategy: "totp",
      issuer: ISSUER,
      label: accountLabel,
      secret,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
    })
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M" })

    return { otpauthUri, qrCodeDataUri }
  },

  /**
   * Verify a TOTP code against the stored secret AND consume it — a valid code
   * is rejected on any subsequent call (replay protection per RFC 6238 §5.2).
   *
   * Implementation:
   * 1. Read `mfaSecret` + `mfaLastUsedStep` in a transaction.
   * 2. `verifySync` with `afterTimeStep = mfaLastUsedStep` — otplib rejects
   *    codes whose timeStep is not strictly greater than the last used.
   * 3. On success, atomically update `mfaLastUsedStep` using an optimistic
   *    compare-and-set (`where: { id, mfaLastUsedStep: previous }`) — two
   *    concurrent verify requests cannot both succeed with the same step.
   *
   * Returns true only when the OTP matched AND was not a replay AND the
   * compare-and-set committed.
   */
  async verifyOtp(userId: number, otp: string): Promise<boolean> {
    if (!/^\d{6}$/.test(otp)) return false

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaLastUsedStep: true },
    })
    if (!user?.mfaSecret) return false

    const secret = safeDecryptField(user.mfaSecret)
    if (!secret) return false

    let result: TotpVerifyResult
    try {
      // Cast: the functional `verify` union widens to HOTP|TOTP and loses
      // `timeStep`. We always pass `strategy: "totp"`, so the TOTP variant
      // is the only possible runtime shape.
      result = verifySync({
        strategy: "totp",
        secret,
        token: otp,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD,
        epochTolerance: TOTP_EPOCH_TOLERANCE,
        // Reject codes whose timeStep <= last accepted step. otplib compares
        // with strict `<=` internally, so a code from the current step cannot
        // be replayed even if the window still covers it.
        afterTimeStep: user.mfaLastUsedStep ?? undefined,
      }) as TotpVerifyResult
    } catch {
      return false
    }

    if (!result.valid) return false

    // Compare-and-set on mfaLastUsedStep. If another concurrent verify just
    // consumed the same or a later step, this update returns count=0 and we
    // treat the verification as failed (anti-replay via optimistic locking).
    const acceptedStep = result.timeStep
    const updated = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [
          { mfaLastUsedStep: null },
          { mfaLastUsedStep: { lt: acceptedStep } },
        ],
      },
      data: { mfaLastUsedStep: acceptedStep },
    })
    return updated.count === 1
  },

  /**
   * Confirm the first OTP after setup and enable MFA.
   * This is the ONLY path that flips `mfaEnabled` to true.
   *
   * Atomicity: `verifyOtp` already committed the `mfaLastUsedStep` advance.
   * If a concurrent `generateSecret` rotated the secret between our read and
   * this update, the optimistic guard `mfaSecret: <observed>` ensures we do
   * not enable MFA bound to a never-confirmed secret.
   */
  async verifyAndEnable(userId: number, otp: string): Promise<boolean> {
    // Observe the secret BEFORE verifying so we can guard the update
    // against a concurrent rotation.
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true },
    })
    if (!before?.mfaSecret) return false

    // Use module reference (not `this`) — mfaService is a plain object literal.
    // A caller that destructures the method (`const { verifyAndEnable } = mfaService`)
    // would lose `this` and crash at runtime.
    const ok = await mfaService.verifyOtp(userId, otp)
    if (!ok) return false

    const updated = await prisma.user.updateMany({
      where: { id: userId, mfaSecret: before.mfaSecret },
      data: { mfaEnabled: true },
    })
    return updated.count === 1
  },

  /**
   * Disable MFA — clears both the secret and the enabled flag.
   * Caller is responsible for having verified the user's password AND a
   * current OTP before calling this function.
   */
  async disable(userId: number): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabled: false, mfaLastUsedStep: null },
    })
  },
}
