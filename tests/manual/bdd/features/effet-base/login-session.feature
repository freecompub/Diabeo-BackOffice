# language: fr
# Source : docs/qa/01-auth.md — effet base de la connexion (INSERT sessions)
Fonctionnalité: Vérification « effet base » — session de connexion

  Scénario: la connexion DOCTOR crée une session active en base
    Étant donné que je suis connecté en tant que "DOCTOR"
    Alors une session active existe en base pour "DOCTOR"
    # Effet base: INSERT sessions (cf. docs/qa/01-auth.md)
