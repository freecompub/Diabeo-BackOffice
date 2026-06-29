# US-2626 — Fix RDV : colonne `@db.Time` traitée comme instant (badge « imminent » mort + heure décalée)

> 📌 **medecin** · Priorité **V1** · Type **BUG** · Suivi de US-2625 (révélé par la revue)

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2626` |
| **Type** | Bug (préexistant, hors périmètre US-2625) |
| **Priorité** | **V1** |
| **Story points** | **2** |
| **Persona** | DOCTOR, NURSE (carte Rendez-vous du jour) |
| **Composant** | `src/components/diabeo/dashboard/medecin/AppointmentCard.tsx` + service RDV |

---

## 📋 Contexte

`Appointment.hour` est une colonne `DateTime? @db.Time` (heure du jour, sans date).
Prisma/`pg` la désérialise **ancrée à `1970-01-01`**. La carte « Rendez-vous du jour »
la traite comme un instant réel :

- `minutesUntil(a.hour)` compare `1970-…` à `Date.now()` (2026) → toujours très négatif
  → `imminent` **toujours faux** : le badge « imminent » et son `aria-label` sont du **code mort**.
- `formatHour(a.hour, …, { timeZone: "Europe/Paris" })` applique l'offset Paris à un
  instant ancré UTC 1970 → l'heure affichée est **décalée de +1/+2 h** (un créneau `09:00`
  s'affiche `10:00`, voire `11:00` en heure d'été).

Bug **préexistant** (antérieur à US-2625, non aggravé par elle). Un test de régression
(`tests/components/dashboard-medecin-format-hour.test.ts`) **fige le comportement actuel**
(08:00 UTC → 10:00 Paris) : il devra être corrigé en même temps.

---

## ✅ Critères d'acceptation

### AC-1 — Heure affichée = heure stockée
```gherkin
Étant donné un RDV à 09:00 (heure cabinet)
Quand la carte « Rendez-vous du jour » l'affiche
Alors elle affiche 09:00 (pas 10:00/11:00), été comme hiver
```

### AC-2 — Badge « imminent » fonctionnel
```gherkin
Étant donné un RDV dans moins de 30 minutes (date du jour + heure)
Quand la carte s'affiche
Alors le badge « imminent » et son aria-label apparaissent
```

### AC-3 — Test de régression corrigé
```gherkin
Étant donné le test format-hour
Quand le fix est appliqué
Alors le test assert l'heure de paroi correcte (pas le comportement bugué)
```

---

## 📐 Piste technique

Recomposer l'instant du RDV depuis `Appointment.date` (jour calendaire) **+** `Appointment.hour`
(heure du jour), soit côté service (émettre un datetime combiné), soit côté carte (fusion
Y-M-D de `date` + H:M de `hour`) avant tout calcul/affichage. À cadrer avec le chemin d'écriture.

---

## 🔗 Liens

- Révélé par la revue de US-2625 (finding H1/M1 code-reviewer)
- Composant : `AppointmentCard.tsx` ; test : `tests/components/dashboard-medecin-format-hour.test.ts`
