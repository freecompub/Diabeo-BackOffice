# language: fr
# Source : docs/qa/12-communication.md — RDV côté patient (contrat API)
# Note : le 400 scopeRequired est levé avant toute logique de rôle — valide la
# garde de scope obligatoire (un from/to sans memberId ni patientId est refusé).
Fonctionnalité: RDV côté patient

  Scénario: scope obligatoire pour lister les RDV
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/appointments?from=2026-05-01&to=2026-07-01"
    Alors le statut de la réponse est 400
    Et le corps contient "scopeRequired"
