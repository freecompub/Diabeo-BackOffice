# language: fr
# Source : docs/qa/01-auth.md — Écran Mot de passe oublié (/reset-password)
Fonctionnalité: Réinitialisation du mot de passe

  Scénario: la page affiche le formulaire de réinitialisation
    Étant donné que je suis sur "/reset-password"
    Alors je vois l'élément "reset-password-screen"
    Et je vois l'élément "reset-email-field"

  Scénario: demande pour un email existant — message générique anti-énumération
    Étant donné que je suis sur "/reset-password"
    Quand je remplis le champ "#reset-email" avec "docteur@diabeo.test"
    Et je clique l'élément "reset-submit-button"
    Alors je vois le texte "compte existe avec cette adresse"
    # Effet base attendu : verification_token (TTL 1h) — non assertable ici (anti-énumération volontaire)

  Scénario: demande pour un email inexistant — réponse identique
    Étant donné que je suis sur "/reset-password"
    Quand je remplis le champ "#reset-email" avec "personne@diabeo.test"
    Et je clique l'élément "reset-submit-button"
    Alors je vois le texte "compte existe avec cette adresse"
