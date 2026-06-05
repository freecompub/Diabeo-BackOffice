# language: fr
# Source : docs/qa/02-dashboards.md, 06-admin.md, 12-communication.md
Fonctionnalité: Redirections RBAC entre rôles

  Scénario: un VIEWER est redirigé hors des pages pro
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je vais sur "/patients"
    Alors je suis redirigé vers "/patient/dashboard"

  Scénario: un DOCTOR n'accède pas au hub admin
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/admin"
    Alors je ne vois pas le titre "Tableau de bord administrateur"

  Scénario: un ADMIN accède au hub admin
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je vais sur "/admin"
    Alors je vois le titre "Tableau de bord administrateur"

  Scénario: /users (legacy) redirige vers /admin/users (anomalie A5)
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je vais sur "/users"
    Alors je suis redirigé vers "/admin/users"
