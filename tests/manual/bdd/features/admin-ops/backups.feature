# language: fr
# Source : docs/qa/08-admin-ops.md — Backups PostgreSQL (/admin/backups)
# Dette (itération ultérieure) : le déclenchement (POST -> 202), le concurrency
# guard (409) et le rate-limit (429, 3/h user) exigent des préconditions d'état
# (un backup déjà running / 3 déjà déclenchés dans l'heure) + ont des effets de
# bord (pg_dump). Couverts par les tests unitaires ; ici on porte le contrat
# lecture seule + RBAC, robuste et sans pollution.
Fonctionnalité: Backups PostgreSQL

  Scénario: un ADMIN liste les backups
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand j'appelle GET "/api/admin/backups"
    Alors le statut de la réponse est 200
    Et le corps contient "items"

  Scénario: un non-ADMIN ne peut pas lister les backups
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/admin/backups"
    Alors le statut de la réponse est 403
