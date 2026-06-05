# language: fr
# Source : docs/qa/10-devices-documents-events.md — création événement (effet base)
# Précondition seed : les patients ont gdprConsent=true (sinon 403 gdprConsentRequired).
Fonctionnalité: Création d'un événement diabète

  Scénario: un DOCTOR crée un événement glycémie pour un patient — effet base
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/events?patientId=1" avec le JSON:
      """
      {"eventDate":"2026-06-05T10:00:00.000Z","eventTypes":["glycemia"],"glycemiaValue":145}
      """
    Alors le statut de la réponse est 201
    Et un événement existe en base avec l'id de la réponse
    # Effet base: INSERT diabetes_events(eventTypes, glycemiaValue) + audit
    # (le chiffrement du `comment` n'est pas exercé ici : aucun comment envoyé)

  Scénario: glycémie hors bornes cliniques refusée
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/events?patientId=1" avec le JSON:
      """
      {"eventDate":"2026-06-05T10:00:00.000Z","eventTypes":["glycemia"],"glycemiaValue":5}
      """
    Alors le statut de la réponse est 400

  Scénario: un patient enregistre son propre événement
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je POST "/api/events" avec le JSON:
      """
      {"eventDate":"2026-06-05T10:00:00.000Z","eventTypes":["glycemia"],"glycemiaValue":120}
      """
    Alors le statut de la réponse est 201
