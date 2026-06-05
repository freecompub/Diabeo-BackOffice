# language: fr
# Source : docs/qa/01-auth.md — Écran Connexion (/login)
Fonctionnalité: Connexion au backoffice

  Scénario: le bouton reste désactivé tant que le formulaire est incomplet
    Étant donné que je suis sur la page de connexion
    Alors le bouton de connexion est désactivé
    Quand je saisis l'email "docteur@diabeo.test"
    Et je saisis le mot de passe "DEV-ONLY-Doctor123!"
    Alors le bouton de connexion est activé

  Scénario: connexion réussie d'un DOCTOR
    Étant donné que je suis sur la page de connexion
    Quand je saisis l'email "docteur@diabeo.test"
    Et je saisis le mot de passe "DEV-ONLY-Doctor123!"
    Et je clique sur le bouton de connexion
    Alors je suis redirigé vers "/medecin"
    # Effet base attendu : INSERT sessions + audit_logs(action=LOGIN, resource=SESSION)

  Scénario: identifiants invalides — message générique anti-énumération
    Étant donné que je suis sur la page de connexion
    Quand je saisis l'email "inconnu@diabeo.test"
    Et je saisis le mot de passe "mauvais-mot-de-passe"
    Et je clique sur le bouton de connexion
    Alors je reste sur la page de connexion
    Et je vois une alerte d'erreur
    # Effet base attendu : audit_logs(action=UNAUTHORIZED) + incrément rate-limit
