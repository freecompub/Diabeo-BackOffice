# language: fr
# Source : docs/qa/10-devices-documents-events.md — supervision appareils (contrat API + RBAC)
Fonctionnalité: Appareils

  Scénario: un patient voit ses appareils
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/devices"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR accède au statut de sync de cohorte
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/devices/sync-status/cohort"
    Alors le statut de la réponse est 200

  Scénario: un patient ne voit pas la cohorte
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/devices/sync-status/cohort"
    Alors le statut de la réponse est 403
