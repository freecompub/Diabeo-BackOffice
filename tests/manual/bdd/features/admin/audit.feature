# language: fr
# Source : docs/qa/08-admin-ops.md — consultation audit (contrat API + RBAC ADMIN)
Fonctionnalité: Consultation de l'audit

  Scénario: un ADMIN consulte l'audit
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/audit-logs?limit=5"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR ne peut pas consulter l'audit
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/audit-logs?limit=5"
    Alors le statut de la réponse est 403

  Scénario: limite de pagination invalide
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/audit-logs?limit=9999"
    Alors le statut de la réponse est 400
