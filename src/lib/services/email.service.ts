import { Resend } from "resend"
import { logger } from "@/lib/logger"

let _client: Resend | null = null

function getClient(): Resend {
  if (_client) return _client
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY not configured")
  _client = new Resend(apiKey)
  return _client
}

const FROM = process.env.EMAIL_FROM ?? "Diabeo <noreply@diabeo.fr>"

interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
}

interface EmailResult {
  sent: boolean
  id?: string
  error?: string
}

export const emailService = {
  async send(input: SendEmailInput): Promise<EmailResult> {
    try {
      const client = getClient()
      const { data, error } = await client.emails.send({
        from: FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      })

      if (error) {
        logger.error("email", "Send failed", {}, error)
        return { sent: false, error: error.message }
      }

      return { sent: true, id: data?.id }
    } catch (err) {
      if (err instanceof Error && err.message.includes("RESEND_API_KEY")) {
        throw err
      }
      logger.error("email", "Send error", {}, err)
      return { sent: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
  },

  async sendPasswordReset(email: string, resetToken: string): Promise<EmailResult> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.diabeo.fr"
    const resetUrl = `${baseUrl}/reset-password/${resetToken}`

    return this.send({
      to: email,
      subject: "Diabeo — Réinitialisation de votre mot de passe",
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0D9488; font-size: 24px; margin: 0;">Diabeo</h1>
          </div>
          <h2 style="color: #1F2937; font-size: 18px;">Réinitialisation de mot de passe</h2>
          <p style="color: #6B7280; line-height: 1.6;">
            Vous avez demandé la réinitialisation de votre mot de passe.
            Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetUrl}" style="background: #0D9488; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Réinitialiser mon mot de passe
            </a>
          </div>
          <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">
            Ce lien expire dans 1 heure. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            Diabeo — Supervision de l'insulinothérapie<br/>
            Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `Réinitialisation de mot de passe Diabeo\n\nCliquez ici pour réinitialiser : ${resetUrl}\n\nCe lien expire dans 1 heure.`,
    })
  },

  async sendWelcome(email: string, firstName: string): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: "Bienvenue sur Diabeo",
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0D9488; font-size: 24px;">Bienvenue sur Diabeo, ${firstName} !</h1>
          <p style="color: #6B7280; line-height: 1.6;">
            Votre compte a été créé avec succès. Vous pouvez maintenant accéder à votre espace de supervision de l'insulinothérapie.
          </p>
          <p style="color: #9CA3AF; font-size: 12px; text-align: center; margin-top: 32px;">
            Diabeo — Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `Bienvenue sur Diabeo, ${firstName} !\n\nVotre compte a été créé avec succès.`,
    })
  },

  async sendProposalNotification(email: string, action: "accepted" | "rejected"): Promise<EmailResult> {
    const actionFr = action === "accepted" ? "acceptée" : "refusée"
    return this.send({
      to: email,
      subject: `Diabeo — Proposition d'ajustement ${actionFr}`,
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0D9488; font-size: 24px;">Diabeo</h1>
          <p style="color: #6B7280; line-height: 1.6;">
            Une proposition d'ajustement de votre traitement a été <strong>${actionFr}</strong> par votre médecin.
            Connectez-vous à l'application pour consulter les détails.
          </p>
          <p style="color: #9CA3AF; font-size: 12px; text-align: center; margin-top: 32px;">
            Diabeo — Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `Proposition d'ajustement ${actionFr}\n\nConnectez-vous à Diabeo pour consulter les détails.`,
    })
  },
}
