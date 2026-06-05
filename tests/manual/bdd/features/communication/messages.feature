# language: fr
# Source : docs/qa/12-communication.md — messagerie sécurisée (contrat API + RBAC)
# Pré-requis seed : gdprConsent actif sur DOCTOR + patient_dt1 (sinon 403, pas 200).
Fonctionnalité: Messagerie sécurisée

  Scénario: un DOCTOR liste ses conversations
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/messages"
    Alors le statut de la réponse est 200

  Scénario: un DOCTOR consulte son compteur de non-lus
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/messages/unread-count"
    Alors le statut de la réponse est 200

  Scénario: un patient accède à sa messagerie
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand j'appelle GET "/api/messages"
    Alors le statut de la réponse est 200

  Scénario: envoi avec un corps invalide refusé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/messages" avec le JSON:
      """
      {}
      """
    Alors le statut de la réponse est 422

  Scénario: envoi sans en-tête CSRF refusé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/messages" sans en-tête CSRF avec le JSON:
      """
      {"toUserId":1,"body":"x"}
      """
    Alors le statut de la réponse est 403
    Et le corps contient "csrfMissing"
