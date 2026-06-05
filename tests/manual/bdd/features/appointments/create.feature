# language: fr
# Source : docs/qa/04-appointments.md — création RDV (POST /api/appointments)
Fonctionnalité: Création d'un rendez-vous

  Scénario: un DOCTOR crée un RDV — vérification effet base
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je crée un RDV pour le patient 1 et le membre 1
    Alors le statut de la réponse est 201
    Et le RDV créé a le statut "scheduled" en base
    # Effet base: INSERT appointments(status=scheduled, motifEncrypted) + audit CREATE

  Scénario: en-tête CSRF manquant
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/appointments" sans en-tête CSRF avec le JSON:
      """
      {"patientId":1,"memberId":1,"date":"2026-09-01","hour":"10:00","durationMinutes":30,"location":"in_person","type":"diabeto"}
      """
    Alors le statut de la réponse est 403

  Scénario: un VIEWER ne peut pas créer de RDV
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je POST "/api/appointments" avec le JSON:
      """
      {"patientId":1,"memberId":1,"date":"2026-09-01","hour":"10:00","durationMinutes":30,"location":"in_person","type":"diabeto"}
      """
    Alors le statut de la réponse est 403
