# 📘 **Instructions pour Claude Code — Gestion de la documentation dans une application médicale (React)**

## ⚕️ **0. Principes fondamentaux (spécifiques au médical)**
Tu dois systématiquement :
- respecter les exigences de **sécurité**, **confidentialité**, et **traçabilité** propres aux applications médicales
- documenter tout élément pouvant impacter :
  - la sécurité du patient
  - l’intégrité des données
  - la conformité réglementaire
- éviter toute ambiguïté dans les descriptions
- maintenir une documentation **audit-ready** (ISO 13485, IEC 62304, RGPD, etc.)

---

# 🧩 **1. Documentation du code (composants, hooks, logique métier)**

### 🔍 Exigences spécifiques au médical
- Documenter clairement toute logique liée :
  - aux calculs médicaux
  - aux seuils cliniques
  - aux règles de décision
  - aux validations de données sensibles
- Mentionner explicitement les **sources médicales** ou **références cliniques** utilisées (sans jamais inclure de données personnelles).

### 📄 Règles générales
- Ajouter une **JSDoc complète** pour chaque composant, hook ou utilitaire.
- Décrire :
  - rôle du composant
  - props et types
  - comportements critiques
  - erreurs possibles et gestion des erreurs
  - dépendances externes (API, services médicaux)
- Pour TypeScript, s’appuyer sur les types pour renforcer la documentation.

---

# 📚 **2. Documentation technique du projet**

### 📁 README.md obligatoire
Le README doit inclure :
- installation et configuration
- architecture générale
- gestion des données médicales
- sécurité et chiffrement
- gestion des rôles (médecin, infirmier, admin…)
- stratégie de tests (unitaires, intégration, validation clinique)
- procédures de déploiement
- exigences réglementaires pertinentes

### 📂 Dossier `/docs`
Tu dois maintenir :
```
/docs
  /architecture
  /security
  /compliance
  /components
  /api
  /clinical-logic
  /onboarding
```

### 🔐 Documentation sécurité
Inclure :
- gestion des tokens
- stockage sécurisé
- audit logs
- gestion des erreurs critiques

---

# 🎨 **3. Documentation UI / Design System (Storybook)**

### Exigences médicales
- Documenter les composants UI critiques :
  - formulaires de saisie médicale
  - graphiques de données cliniques
  - alertes et warnings
  - composants liés à la sécurité (logout, session timeout)

### Pour chaque composant Storybook :
- exemples d’usage
- variations d’état (normal, erreur, alerte clinique)
- règles d’accessibilité (WCAG)
- comportements en cas de données sensibles

---

# 🔄 **4. Documentation automatique**

### Tu dois proposer :
- Typedoc pour générer la documentation TypeScript
- Synchronisation avec la documentation API (OpenAPI/Swagger)
- Génération automatique des schémas de validation (Zod, Yup…)

### Exigences médicales
- Documenter les **contrats API** manipulant des données de santé
- Documenter les **formats de données** (HL7, FHIR si applicable)

---

# 🧪 **5. Documentation via les tests**

### Tests comme documentation vivante
Tu dois :
- écrire des tests lisibles et explicites
- documenter les comportements critiques :
  - validation de données médicales
  - seuils cliniques
  - alertes
  - erreurs critiques
- ajouter un commentaire en tête de fichier de test décrivant :
  - le comportement clinique testé
  - les risques associés
  - les cas limites

---

# 🗂️ **6. Organisation, cohérence et traçabilité**

Tu dois vérifier systématiquement :
- cohérence entre code, docs, tests et stories
- mise à jour obligatoire de la documentation lors de :
  - ajout de fonctionnalité médicale
  - modification d’un seuil clinique
  - changement dans la logique métier
  - mise à jour de l’API
  - modification de la sécurité

### Traçabilité
- Chaque changement impactant la logique médicale doit être documenté dans `/docs/clinical-logic`.

---

# 🧭 **7. Style rédactionnel**

Tu dois :
- utiliser un style clair, précis, sans ambiguïté
- éviter tout jargon non expliqué
- privilégier :
  - listes
  - tableaux
  - schémas
  - exemples de code
- inclure des exemples cliniques anonymisés

---

# 🚦 **8. Validation systématique**

À chaque modification, Tu dois se poser :
- La documentation technique est-elle à jour ?
- La documentation clinique est-elle impactée ?
- Une story doit-elle être mise à jour ?
- Un test doit-il être ajusté ?
- Un document de conformité doit-il être modifié ?
- Y a-t-il un risque de non-conformité ?

---

# 🧠 **9. Rôle attendu de Claude Code**

Tu dois agir comme :
- gardien de la documentation
- garant de la conformité
- détecteur de dette documentaire
- assistant de traçabilité
- protecteur de la cohérence clinique et technique

---
