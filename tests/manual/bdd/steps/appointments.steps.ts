import { createBdd } from "playwright-bdd"
import { world } from "./world"

const { When } = createBdd()

const CSRF_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
}

const pad2 = (n: number) => n.toString().padStart(2, "0")

/** Créneau futur quasi-unique (idempotence des rejeux ; évite slotConflict 409). */
function uniqueFutureSlot(): { date: string; hour: string } {
  const now = Date.now()
  const d = new Date()
  d.setDate(d.getDate() + 30 + (now % 60)) // J+30..J+89
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const hour = `${pad2(8 + (Math.floor(now / 1000) % 11))}:${pad2(now % 60)}` // 08–18h
  return { date, hour }
}

When(
  "je crée un RDV pour le patient {int} et le membre {int}",
  async ({ page }, patientId: number, memberId: number) => {
    const { date, hour } = uniqueFutureSlot()
    const res = await page.request.post("/api/appointments", {
      headers: CSRF_HEADERS,
      data: {
        patientId,
        memberId,
        date,
        hour,
        durationMinutes: 30,
        location: "in_person",
        type: "diabeto",
        motif: "QA BDD",
      },
    })
    world.status = res.status()
    world.body = await res.json().catch(() => null)
    world.createdAppointmentId = (world.body as { id?: number } | null)?.id ?? 0
  },
)

When("j'annule le RDV créé en tant que {string}", async ({ page }, actor: string) => {
  const res = await page.request.post(
    `/api/appointments/${world.createdAppointmentId}/cancel`,
    { headers: CSRF_HEADERS, data: { actor, reason: "QA BDD cancel" } },
  )
  world.status = res.status()
  world.body = await res.json().catch(() => null)
})
