# Rapport d'exécution QA — 04-appointments.md · Chrome / AR

**Date** : 2026-06-11 · **Chrome** · **AR/RTL**

## Synthèse

| Scénario | Résultat |
|---|---|
| Page `/appointments` traduite — "المواعيد", sous-titre, bouton "+ موعد جديد" | ✅ OK |
| Message "لا توجد عيادة مرتبطة بحسابك" (ADMIN sans cabinet) | ✅ OK |
| État vide "لم يتم تحديد عيادة" + instructions en arabe | ✅ OK |
| RTL layout — nav droite, contenu gauche | ✅ OK |
| Aucune chaîne FR | ✅ OK |

**5 OK · 0 KO · 0 écart**

## Note
ADMIN n'a pas de cabinet attaché → état "aucune éiabète sélectionnée" affiché. Calendrier Schedule-X non chargé (pas de memberId). Comportement identique au FR pour ce cas limite.
