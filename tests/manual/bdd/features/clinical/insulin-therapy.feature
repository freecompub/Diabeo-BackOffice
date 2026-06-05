# language: fr
# Source : docs/qa/11-clinical.md — insulinothérapie (contrat API + bornes cliniques)
Fonctionnalité: Configuration insulinothérapie

  Scénario: un DOCTOR lit la configuration d'un patient
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand j'appelle GET "/api/insulin-therapy/settings?patientId=1"
    Alors le statut de la réponse est 200

  Scénario: ISF au-dessus de la borne max (1.00 g/L/U) refusé
    Étant donné que je suis connecté en tant que "NURSE"
    Quand je POST "/api/insulin-therapy/sensitivity-factors?patientId=1" avec le JSON:
      """
      {"startHour":8,"endHour":12,"sensitivityFactorGl":5.0}
      """
    Alors le statut de la réponse est 400

  Scénario: ISF sous la borne min (0.10 g/L/U) refusé
    Étant donné que je suis connecté en tant que "NURSE"
    Quand je POST "/api/insulin-therapy/sensitivity-factors?patientId=1" avec le JSON:
      """
      {"startHour":8,"endHour":12,"sensitivityFactorGl":0.05}
      """
    Alors le statut de la réponse est 400

  Scénario: un VIEWER ne peut pas écrire la configuration
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je POST "/api/insulin-therapy/sensitivity-factors?patientId=1" avec le JSON:
      """
      {"startHour":8,"endHour":12,"sensitivityFactorGl":0.50}
      """
    Alors le statut de la réponse est 403
