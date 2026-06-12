# Rapport d'exécution QA — 05-settings.md

**Date** : 2026-06-11 · **Chrome** · **FR** · **Rôle** : DOCTOR

## Synthèse

| Scénario | Résultat |
|---|---|
| Affichage settings DOCTOR — 6 sections (sans sections patient-only) | ✅ OK |
| Section "Infos personnelles" préremplie (Sophie Martin) | ✅ OK |
| Boutons "Exporter en PDF" / "Exporter en JSON" visibles | ✅ OK |
| `GET /api/account/sessions → 200` | ✅ OK |
| `PUT /api/account/units` sans `X-Requested-With` → 403 csrfMissing | ✅ OK |
| `PUT /api/account/locale` → 200 | ✅ OK |
| Sections patient-only absentes (DOCTOR) : Données médicales, Administratif, Moments, Confidentialité | ✅ OK |
| Modification infos / unités / notifications / sessions (écritures) | ⏭️ Non exécuté |

**7 OK · 0 KO · 0 écart**

## Détail

- **Sections DOCTOR** : "Informations personnelles", "Contact", "Unites de mesure", "Notifications", "Sessions actives", "Langue" — les 4 sections patient-only absentes ✅.
- **Profil** : Prénom "Sophie", Nom "Martin" affichés ✅. Genre "Non specifie" ✅.
- **Export RGPD** : boutons "Exporter en PDF" et "Exporter en JSON" présents ✅.
- **CSRF** : PUT sans `X-Requested-With` → 403 ✅.
- **Locale** : `PUT /api/account/locale` → 200 ✅ (retour en FR confirmé).

## Anomalies i18n

"Parametres" (×2), "preferences", "Prenom", "Unites de mesure", "Non specifie" — même source que les autres domaines.

## Non couvert

- Sauvegarde infos perso (PUT → toast), unités, notifications, export RGPD déclenché.
- Sections patient (VIEWER) : Données médicales, Administratif, Moments, Confidentialité.
- Révocation session active.
- Export avec rate-limit (3/h).

## Captures

| Fichier | État |
|---|---|
| `settings_settings_profil-doctor.jpg` | Page settings DOCTOR, infos personnelles |
