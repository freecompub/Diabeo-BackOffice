# language: fr
# Source : docs/qa/05-settings.md — accès /settings PS vs patient (§7)
Fonctionnalité: Accès RBAC aux paramètres (/settings)

  Scénario: un professionnel de santé accède à /settings (non redirigé)
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je vais sur "/settings"
    Alors je reste sur "/settings"

  Scénario: un patient (VIEWER) est redirigé hors de /settings (layout dashboard)
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je vais sur "/settings"
    Alors je suis redirigé vers "/patient/dashboard"
