# language: fr
# Source : docs/qa/08-admin-ops.md — Santé système (/admin/system-health)
Fonctionnalité: Santé système

  Scénario: snapshot santé pour un ADMIN
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/system-health"
    Alors le statut de la réponse est 200
    Et le corps contient "components"
    Et le corps contient "unauthorizedAttempts24h"

  Scénario: un non-ADMIN ne voit pas la santé système
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/system-health"
    Alors le statut de la réponse est 403
