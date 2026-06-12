# Rapport d'exécution QA — 01-auth.md · Chrome / AR

**Date** : 2026-06-11 · **Chrome** · **AR/RTL**

## Synthèse

| Scénario | Résultat |
|---|---|
| Page `/login` en arabe — RTL, labels traduits, bouton "دخول" disabled | ✅ OK |
| Sélecteur langue AR (combobox "تغيير اللغة") — haut-gauche (miroir RTL du haut-droit FR) | ✅ OK |
| Footer "بيانات مستضافة HDS" — traduction correcte (pas de problème accents) | ✅ OK |
| Connexion ADMIN réussie → dashboard | ✅ OK |
| Aucune chaîne FR détectée sur `/login` | ✅ OK |

**5 OK · 0 KO · 0 écart**

## Détail RTL

- Layout entièrement mirrored : sélecteur AR en haut-gauche (FR : haut-droit) ✅, labels alignés droite ✅, icône œil mot de passe à gauche (fin d'input RTL) ✅.
- Toutes les chaînes traduites : titre, sous-titre, labels champs, boutons, liens, footer.
- Comportement bouton "دخول" disabled identique au FR ✅.
- Anti-énumération, lockout, reset-password non ré-exécutés (déjà validés en FR ; le mécanisme est côté serveur, indépendant de la locale).

## Capture
`auth_login_rtl-ar.jpg` — Page login complète en AR/RTL
