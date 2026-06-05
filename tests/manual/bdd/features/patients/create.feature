# language: fr
# Source : docs/qa/03-patients.md — Création patient (POST /api/patients)
Fonctionnalité: Création d'un patient

  Scénario: création réussie par un DOCTOR — vérification effet base
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je crée un patient avec un email unique
    Alors le statut de la réponse est 201
    Et un compte patient existe en base avec l'email créé
    # Effet base: INSERT users(role=VIEWER, PII chiffrées) + patients + audit CREATE

  Scénario: email déjà utilisé
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/patients" avec le JSON:
      """
      {"email":"patient.dt1@diabeo.test","firstName":"A","lastName":"B","pathology":"DT1"}
      """
    Alors le statut de la réponse est 409
    Et le corps contient "emailExists"

  Scénario: en-tête CSRF manquant
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/patients" sans en-tête CSRF avec le JSON:
      """
      {"email":"qa.csrf@diabeo.test","firstName":"A","lastName":"B","pathology":"DT1"}
      """
    Alors le statut de la réponse est 403

  Scénario: validation échouée (pathologie manquante)
    Étant donné que je suis connecté en tant que "DOCTOR"
    Quand je POST "/api/patients" avec le JSON:
      """
      {"email":"qa.val@diabeo.test","firstName":"A","lastName":"B"}
      """
    Alors le statut de la réponse est 400
