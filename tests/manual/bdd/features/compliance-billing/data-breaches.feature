# language: fr
# Source : docs/qa/09-admin-compliance-billing.md — violations RGPD (RBAC ADMIN)
Fonctionnalité: Registre des violations de données (RGPD Art. 33)

  Scénario: un ADMIN liste les violations
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/data-breaches"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR ne peut pas consulter les violations
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/data-breaches"
    Alors le statut de la réponse est 403
