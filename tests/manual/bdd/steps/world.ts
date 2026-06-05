/**
 * État partagé entre steps (réponse API courante, email créé…).
 * L'exécution BDD est sérielle (workers: 1) → un module mutable est sûr et
 * évite de configurer une fixture « World » playwright-bdd.
 */
export const world: {
  status: number
  body: unknown
  createdEmail: string
  createdAppointmentId: number
} = {
  status: 0,
  body: null,
  createdEmail: "",
  createdAppointmentId: 0,
}
