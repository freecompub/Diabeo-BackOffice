import { Resend } from "resend"
import { logger } from "@/lib/logger"

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
}

let _client: Resend | null = null

function getClient(): Resend {
  if (_client) return _client
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error("RESEND_API_KEY not configured")
  _client = new Resend(apiKey)
  return _client
}

const FROM = process.env.EMAIL_FROM ?? "Diabeo <noreply@diabeo.fr>"

/**
 * US-2108 — i18n templates relances factures (FR/EN/AR).
 * Aucune mention donnee sante. Trois tons gradues (amical/ferme/final).
 */
type ReminderStep = "step_7" | "step_15" | "step_30"
interface ReminderStepCopy {
  subject: (invoiceNumber: string) => string
  heading: string
  body: string
  footer: string
}
interface ReminderI18n {
  labels: { invoice: string; amount: string; dueDate: string; cta: string }
  step_7: ReminderStepCopy
  step_15: ReminderStepCopy
  step_30: ReminderStepCopy
}

/**
 * US-2502 — i18n template rappel RDV J-2.
 * Aucune mention donnee sante / nom / DDN / NIR / INS / nom medecin.
 */
interface AppointmentReminderI18n {
  subject: (dateTime: string) => string
  heading: string
  body: string
  footer: string
  labels: { dateTime: string; location: string; cta: string }
  locations: { in_person: string; video: string; phone: string }
}

const APPOINTMENT_REMINDER_I18N: Record<"fr" | "en" | "ar", AppointmentReminderI18n> = {
  fr: {
    subject: (dt) => `Diabeo — Rappel rendez-vous le ${dt}`,
    heading: "Rappel de votre rendez-vous",
    body: "Nous vous rappelons votre rendez-vous prévu dans 2 jours. Si vous ne pouvez plus venir, merci d'annuler dès que possible via l'application.",
    footer: "Vous recevrez également un rappel la veille et le jour même.",
    labels: { dateTime: "Date et heure", location: "Lieu", cta: "Voir le rendez-vous" },
    locations: { in_person: "En cabinet", video: "Vidéo (téléconsultation)", phone: "Téléphone" },
  },
  en: {
    subject: (dt) => `Diabeo — Appointment reminder on ${dt}`,
    heading: "Appointment reminder",
    body: "This is a reminder for your appointment in 2 days. If you can no longer attend, please cancel as soon as possible via the application.",
    footer: "You will also receive a reminder the day before and on the day itself.",
    labels: { dateTime: "Date and time", location: "Location", cta: "View appointment" },
    locations: { in_person: "In-cabinet", video: "Video (teleconsultation)", phone: "Phone" },
  },
  ar: {
    subject: (dt) => `Diabeo — تذكير بموعدك في ${dt}`,
    heading: "تذكير بموعدك",
    body: "نذكرك بموعدك المحدد بعد يومين. إذا لم تعد قادرا على الحضور، يرجى الإلغاء في أقرب وقت ممكن عبر التطبيق.",
    footer: "ستتلقى أيضًا تذكيرًا اليوم السابق وفي اليوم نفسه.",
    labels: { dateTime: "التاريخ والوقت", location: "الموقع", cta: "عرض الموعد" },
    locations: { in_person: "في العيادة", video: "فيديو (استشارة عن بعد)", phone: "هاتف" },
  },
}

const REMINDER_I18N: Record<"fr" | "en" | "ar", ReminderI18n> = {
  fr: {
    labels: { invoice: "Numéro de facture", amount: "Montant", dueDate: "Échéance", cta: "Régler la facture" },
    step_7: {
      subject: (n) => `Diabeo — Facture ${n} en attente de règlement`,
      heading: "Votre facture est en attente de règlement",
      body: "Nous vous rappelons amicalement que votre facture est en attente de paiement. Si vous l'avez déjà réglée, merci d'ignorer ce message.",
      footer: "Pour toute question, contactez votre cabinet via l'application.",
    },
    step_15: {
      subject: (n) => `Diabeo — Deuxième relance : facture ${n} impayée`,
      heading: "Deuxième relance — facture impayée",
      body: "Votre facture est toujours en attente de paiement. Merci de procéder au règlement dans les meilleurs délais.",
      footer: "Sans règlement de votre part sous 15 jours, une procédure de recouvrement pourra être engagée.",
    },
    step_30: {
      subject: (n) => `Diabeo — DERNIÈRE relance avant procédure : facture ${n}`,
      heading: "Dernière relance avant procédure",
      body: "Votre facture demeure impayée malgré nos précédentes relances. Sans règlement immédiat, une procédure de recouvrement sera engagée.",
      footer: "Pour éviter toute procédure, merci de régulariser votre situation sans délai.",
    },
  },
  en: {
    labels: { invoice: "Invoice number", amount: "Amount", dueDate: "Due date", cta: "Pay invoice" },
    step_7: {
      subject: (n) => `Diabeo — Invoice ${n} pending payment`,
      heading: "Your invoice is pending payment",
      body: "This is a friendly reminder that your invoice is awaiting payment. If you have already paid, please disregard this message.",
      footer: "For any question, contact your cabinet via the application.",
    },
    step_15: {
      subject: (n) => `Diabeo — Second reminder: unpaid invoice ${n}`,
      heading: "Second reminder — unpaid invoice",
      body: "Your invoice remains pending payment. Please proceed with payment as soon as possible.",
      footer: "Without payment within 15 days, a collection procedure may be initiated.",
    },
    step_30: {
      subject: (n) => `Diabeo — FINAL reminder before legal action: invoice ${n}`,
      heading: "Final reminder before legal action",
      body: "Your invoice remains unpaid despite our previous reminders. Without immediate payment, a collection procedure will be initiated.",
      footer: "To avoid any procedure, please settle your account without delay.",
    },
  },
  ar: {
    labels: { invoice: "رقم الفاتورة", amount: "المبلغ", dueDate: "تاريخ الاستحقاق", cta: "تسديد الفاتورة" },
    step_7: {
      subject: (n) => `Diabeo — الفاتورة ${n} في انتظار التسديد`,
      heading: "فاتورتك في انتظار التسديد",
      body: "نذكرك بأن فاتورتك في انتظار التسديد. إذا كنت قد سددتها بالفعل، يرجى تجاهل هذه الرسالة.",
      footer: "لأي سؤال، اتصل بمكتبك عبر التطبيق.",
    },
    step_15: {
      subject: (n) => `Diabeo — تذكير ثانٍ: الفاتورة ${n} غير مسددة`,
      heading: "تذكير ثانٍ — فاتورة غير مسددة",
      body: "لا تزال فاتورتك في انتظار التسديد. يرجى المتابعة في أقرب وقت ممكن.",
      footer: "بدون تسديد خلال 15 يومًا، قد يتم بدء إجراءات التحصيل.",
    },
    step_30: {
      subject: (n) => `Diabeo — تذكير أخير قبل الإجراءات القانونية: الفاتورة ${n}`,
      heading: "تذكير أخير قبل الإجراءات القانونية",
      body: "لا تزال فاتورتك غير مسددة رغم تذكيراتنا السابقة. بدون تسديد فوري، ستبدأ إجراءات التحصيل.",
      footer: "لتجنب أي إجراء، يرجى تسوية وضعك دون تأخير.",
    },
  },
}

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
            <a href="${escapeHtml(resetUrl)}" style="background: #0D9488; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
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

  async sendWelcome(email: string): Promise<EmailResult> {
    return this.send({
      to: email,
      subject: "Bienvenue sur Diabeo",
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0D9488; font-size: 24px;">Bienvenue sur Diabeo !</h1>
          <p style="color: #6B7280; line-height: 1.6;">
            Votre compte a été créé avec succès. Vous pouvez maintenant accéder à votre espace de supervision de l'insulinothérapie.
          </p>
          <p style="color: #9CA3AF; font-size: 12px; text-align: center; margin-top: 32px;">
            Diabeo — Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: "Bienvenue sur Diabeo !\n\nVotre compte a été créé avec succès.",
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

  /**
   * US-2108 — Email de relance facture (cron J+7/J+15/J+30).
   *
   * **Contrat anti-PHI strict** :
   *   - Aucune donnee de sante (TIR, glucose, pathologie, etc.).
   *   - Aucun trait d'identite patient (nom complet, DDN, NIR, INS).
   *   - Le sujet et le corps mentionnent uniquement : numero facture
   *     (FR-2026-000042), montant TTC, date d'echeance, lien deep
   *     authentifie vers la facture dans l'app.
   *
   * **Best-effort** : Resend timeout/erreur ne bloque pas le cron. Le
   * caller `reminderService` log InvoiceReminder.status=failed pour audit.
   *
   * @param input.email          Destinataire (deja decrypte par le service).
   * @param input.invoiceNumber  Numero seq pays "FR-2026-000042" (jamais NULL apres issuance).
   * @param input.totalAmount    Montant TTC formate "120,00 €" (deja localise).
   * @param input.dueDate        Date d'echeance "15 janvier 2026" (deja localise).
   * @param input.step           "step_7" | "step_15" | "step_30" — choisit le ton.
   * @param input.invoiceId      ID interne pour deep link.
   * @param input.language       "fr" | "en" | "ar" (i18n US-2112).
   */
  async sendInvoiceReminder(input: {
    email: string
    invoiceNumber: string
    totalAmount: string
    dueDate: string
    step: "step_7" | "step_15" | "step_30"
    invoiceId: number
    language?: "fr" | "en" | "ar"
  }): Promise<EmailResult> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.diabeo.fr"
    const deepLink = `${baseUrl}/billing/invoices/${input.invoiceId}`
    const lang = input.language ?? "fr"

    const T = REMINDER_I18N[lang]
    const stepCfg = T[input.step]

    return this.send({
      to: input.email,
      subject: stepCfg.subject(input.invoiceNumber),
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;${lang === "ar" ? " direction: rtl;" : ""}">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0D9488; font-size: 24px; margin: 0;">Diabeo</h1>
          </div>
          <h2 style="color: #1F2937; font-size: 18px;">${escapeHtml(stepCfg.heading)}</h2>
          <p style="color: #6B7280; line-height: 1.6;">${escapeHtml(stepCfg.body)}</p>
          <table style="border-collapse: collapse; margin: 24px 0; width: 100%;">
            <tr>
              <td style="padding: 8px 0; color: #6B7280;">${escapeHtml(T.labels.invoice)}</td>
              <td style="padding: 8px 0; color: #1F2937; font-weight: 600; text-align: right;">${escapeHtml(input.invoiceNumber)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280;">${escapeHtml(T.labels.amount)}</td>
              <td style="padding: 8px 0; color: #1F2937; font-weight: 600; text-align: right;">${escapeHtml(input.totalAmount)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280;">${escapeHtml(T.labels.dueDate)}</td>
              <td style="padding: 8px 0; color: #1F2937; font-weight: 600; text-align: right;">${escapeHtml(input.dueDate)}</td>
            </tr>
          </table>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${escapeHtml(deepLink)}" style="background: #0D9488; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              ${escapeHtml(T.labels.cta)}
            </a>
          </div>
          <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">${escapeHtml(stepCfg.footer)}</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            Diabeo — Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `${stepCfg.heading}\n\n${stepCfg.body}\n\n${T.labels.invoice}: ${input.invoiceNumber}\n${T.labels.amount}: ${input.totalAmount}\n${T.labels.dueDate}: ${input.dueDate}\n\n${T.labels.cta}: ${deepLink}\n\n${stepCfg.footer}`,
    })
  },

  /**
   * US-2502 — Email de rappel RDV J-2 (avant échéance).
   *
   * **Contrat anti-PHI strict** :
   *   - AUCUNE donnée de santé (TIR, glucose, pathologie).
   *   - AUCUN nom/DDN/NIR/INS patient ni nom médecin.
   *   - Uniquement : date+heure RDV, lieu type (cabinet/video/phone),
   *     deep link auth.
   *
   * @param input.email         Destinataire (déjà déchiffré par caller).
   * @param input.dateTime      Date+heure formatées localement (ex. "20 mai 2026 à 14h00").
   * @param input.location      Type de RDV (in_person/video/phone).
   * @param input.appointmentId Deep link.
   * @param input.language      "fr" | "en" | "ar" (US-2112).
   */
  async sendAppointmentReminder(input: {
    email: string
    dateTime: string
    location: "in_person" | "video" | "phone" | null
    appointmentId: number
    language?: "fr" | "en" | "ar"
  }): Promise<EmailResult> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.diabeo.fr"
    const deepLink = `${baseUrl}/appointments/${input.appointmentId}`
    const lang = input.language ?? "fr"
    const T = APPOINTMENT_REMINDER_I18N[lang]
    const locationLabel = input.location
      ? T.locations[input.location]
      : T.locations.in_person

    return this.send({
      to: input.email,
      subject: T.subject(input.dateTime),
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;${lang === "ar" ? " direction: rtl;" : ""}">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0D9488; font-size: 24px; margin: 0;">Diabeo</h1>
          </div>
          <h2 style="color: #1F2937; font-size: 18px;">${escapeHtml(T.heading)}</h2>
          <p style="color: #6B7280; line-height: 1.6;">${escapeHtml(T.body)}</p>
          <table style="border-collapse: collapse; margin: 24px 0; width: 100%;">
            <tr>
              <td style="padding: 8px 0; color: #6B7280;">${escapeHtml(T.labels.dateTime)}</td>
              <td style="padding: 8px 0; color: #1F2937; font-weight: 600; text-align: right;">${escapeHtml(input.dateTime)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280;">${escapeHtml(T.labels.location)}</td>
              <td style="padding: 8px 0; color: #1F2937; font-weight: 600; text-align: right;">${escapeHtml(locationLabel)}</td>
            </tr>
          </table>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${escapeHtml(deepLink)}" style="background: #0D9488; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              ${escapeHtml(T.labels.cta)}
            </a>
          </div>
          <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">${escapeHtml(T.footer)}</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            Diabeo — Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `${T.heading}\n\n${T.body}\n\n${T.labels.dateTime}: ${input.dateTime}\n${T.labels.location}: ${locationLabel}\n\n${T.labels.cta}: ${deepLink}\n\n${T.footer}`,
    })
  },

  /**
   * US-2266 — Doctor email on a critical emergency alert.
   *
   * **PHI safety contract — strictly enforced**:
   * - NO alert type, severity, glucose/ketone value in subject or body.
   * - NO patient name, DDN, NIR, or other identifying field.
   * - Only: an opaque internal patient identifier (`Patient #N`), a deep
   *   link requiring auth, and a generic "alerte critique" mention.
   *
   * The email is best-effort: failures must NOT block the underlying alert
   * persistence or FCM push (handled by caller). Sends only if RESEND_API_KEY
   * is configured — returns a sent:false result otherwise.
   *
   * @param input.doctorEmail   Decrypted clinician email (caller responsibility)
   * @param input.alertId       Numeric internal alert id (used to build deep link)
   * @param input.patientInternalId  Numeric internal patient id (NEVER nominative)
   */
  async sendDoctorEmergencyAlert(input: {
    doctorEmail: string
    alertId: number
    patientInternalId: number
  }): Promise<EmailResult> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.diabeo.fr"
    const deepLink = `${baseUrl}/dashboard/emergencies/${input.alertId}`
    const safePatientLabel = `Patient #${input.patientInternalId}`

    return this.send({
      to: input.doctorEmail,
      // Generic subject — no alert type, no severity, no glucose/ketone value.
      subject: "Diabeo — Alerte patient en attente",
      html: `
        <div style="font-family: 'Figtree', system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0D9488; font-size: 24px; margin: 0;">Diabeo</h1>
          </div>
          <h2 style="color: #1F2937; font-size: 18px;">Alerte clinique en attente</h2>
          <p style="color: #6B7280; line-height: 1.6;">
            Une alerte clinique nécessite votre attention pour
            <strong>${escapeHtml(safePatientLabel)}</strong>.
            Connectez-vous au backoffice pour consulter les détails.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${escapeHtml(deepLink)}" style="background: #0D9488; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Voir l'alerte
            </a>
          </div>
          <p style="color: #9CA3AF; font-size: 13px; line-height: 1.5;">
            Cet email ne contient aucune donnée médicale.
            Toutes les informations cliniques restent dans l'espace authentifié.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            Diabeo — Supervision de l'insulinothérapie<br/>
            Hébergement HDS certifié — OVHcloud GRA
          </p>
        </div>
      `,
      text: `Alerte patient Diabeo\n\n${safePatientLabel} — une alerte clinique nécessite votre attention.\n\nConnectez-vous : ${deepLink}\n\nCet email ne contient aucune donnée médicale.`,
    })
  },
}
