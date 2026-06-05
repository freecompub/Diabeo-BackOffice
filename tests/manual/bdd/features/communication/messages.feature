# language: fr
# Source : docs/qa/12-communication.md — messagerie sécurisée (contrat API + RBAC)
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
