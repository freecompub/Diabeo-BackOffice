# language: fr
# Source : docs/qa/02-dashboards.md + 07-dashboards-analytics.md (contrat API + RBAC)
Fonctionnalité: Tableaux de bord par rôle

  Scénario: un DOCTOR accède à ses KPI médecin
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/dashboard/medecin/kpi"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR accède au bloc urgences
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/dashboard/medecin/urgencies"
    Alors le statut de la réponse est 200

  Scénario: un VIEWER ne voit pas le dashboard médecin
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/dashboard/medecin/kpi"
    Alors le statut de la réponse est 403

  Scénario: un ADMIN accède aux KPI admin
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/dashboard/admin/kpi"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR ne voit pas les KPI admin
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/dashboard/admin/kpi"
    Alors le statut de la réponse est 403
