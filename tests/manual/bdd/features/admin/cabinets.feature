# language: fr
# Source : docs/qa/06-admin.md — cabinets / structures (contrat API + RBAC ADMIN)
Fonctionnalité: Administration des cabinets

  Scénario: un ADMIN liste les cabinets
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/healthcare-services"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR ne peut pas administrer les cabinets
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/healthcare-services"
    Alors le statut de la réponse est 403
