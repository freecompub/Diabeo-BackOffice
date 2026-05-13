# US-2408 — Coordination équipe (infirmier)

> 📌 **infirmier** · Priorité **V1** · Satellite de `US-2405`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2408` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | NURSE |
| **Dépendances** | US-2076 (messagerie sécurisée — archi WS chat-only + polling 60s badge + FCM offline, décision session Samir 2026-05-13), US-2073 (Push FCM, DONE), US-2405 |
| **US parente** | `US-2405` |

---

## 📋 Contexte produit

Section à droite du dashboard infirmier avec les messages reçus des médecins et autres soignants. Canal de messagerie INTERNE équipe (distinct de la messagerie patient). Permet au médecin de transmettre des consignes rapidement à l'infirmier.

---

## 🎨 Composition

### Layout
- Header : icône users + 'Coordination équipe'
- Liste verticale messages récents
- Chaque message :
  - Avatar initiales soignant + couleur rôle
  - Nom soignant + heure ('à 9h41', 'hier 17h')
  - Extrait message (1 ligne, ellipsis)
- Tap = ouvre thread complet

### Différentiel messagerie patient
- Canal séparé (DB table distincte)
- Pas de chiffrement E2E (équipe interne au cabinet)
- Pas d'AuditLog patient (juste audit interne)

---

## ✅ Critères d'acceptation

### AC-1 — Messages soignants récents
```gherkin
Étant donné infirmier a reçu 3 messages aujourd'hui
Quand consulte le dashboard
Alors 3 messages visibles dans la section
```

### AC-2 — Tri chronologique inverse
```gherkin
Étant donné messages reçus à différentes heures
Quand se rendent
Alors le plus récent en haut
```

### AC-3 — Tap → thread
```gherkin
Étant donné infirmier clique un message
Quand il valide
Alors thread complet s'ouvre
```

### AC-4 — Empty state
```gherkin
Étant donné aucun message récent
Quand infirmier consulte
Alors 'Aucun nouveau message équipe'
```

### AC-5 — Badge non lu
```gherkin
Étant donné 1 message non lu
Quand section se rend
Alors indicateur visuel discret (point coloré)
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Canal messagerie interne équipe distinct du canal patient
- **RM-2** : Pas de chiffrement E2E (équipe interne)
- **RM-3** : Audit interne uniquement (pas d'AuditLog patient)
- **RM-4** : Max 3-5 messages visibles + CTA 'Voir tous'

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/team/messages?recipient=me&limit=5
  → messages internes récents
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | Liste messages affichée |
| Empty | 'Aucun nouveau message équipe' |
| Loading | Skeleton 3 lignes |
| Non lu | Indicateur visuel |

---

## 🧪 Tests prioritaires

- **Canal distinct** : valider que messagerie patient n'apparaît pas ici
- **Tri chronologique** : valider ordre
- **Tap → thread** : navigation correcte
- **Audit** : valider pas d'AuditLog patient

---

## 📦 DoD dashboard-spécifique

- [ ] Canal interne séparé du canal patient
- [ ] Tri chronologique inverse
- [ ] Navigation thread fonctionnelle
- [ ] Pas d'AuditLog patient déclenché

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2405
- US liée : US-2076

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
