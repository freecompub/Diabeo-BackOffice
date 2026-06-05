# language: fr
# Source : docs/qa/06-admin.md — gestion utilisateurs (contrat API + RBAC ADMIN)
Fonctionnalité: Administration des utilisateurs

  Scénario: un ADMIN liste les utilisateurs
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/users"
    Alors le statut de la réponse est 200
    Et le corps contient "items"

  Scénario: filtrer par rôle DOCTOR
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/users?role=DOCTOR"
    Alors le statut de la réponse est 200
    Et le corps contient "items"

  Scénario: un DOCTOR ne peut pas administrer les utilisateurs
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/users"
    Alors le statut de la réponse est 403

  Scénario: un NURSE ne peut pas administrer les utilisateurs
    Étant donné que je suis connecté en tant que "NURSE"
    Quand j'appelle GET "/api/admin/users"
    Alors le statut de la réponse est 403
