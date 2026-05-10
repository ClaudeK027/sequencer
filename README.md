# Sequence Timer

Mini-application web React de minuteur séquentiel pour gérer un événement composé de plusieurs étapes (cultes, conférences, formations, etc.).

## Stack

- **Vite** + **React 18** + **TypeScript**
- **Zustand** (state + persistance localStorage)
- **CSS pur** (palette inspirée de Linear)
- Aucune dépendance UI lourde

## Démarrage

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de production dans dist/
npm run preview  # sert le build localement
```

## Fonctionnalités

- Plusieurs séquences sauvegardées (bibliothèque latérale)
- Étapes nommées avec durée min:sec (édition inline + drag-and-drop)
- Préréglages de durée (30s, 1m, 5m, etc.)
- Lecture séquentielle automatique avec bip de transition
- Contrôles : play/pause, suivant, précédent, reset
- Code couleur du temps restant (vert > orange > rouge clignotant)
- Mode plein écran pour projection (texte agrandi)
- Import/Export JSON d'une séquence
- Backup/Restore complet (toutes les séquences)
- Persistance automatique dans localStorage
- Raccourcis clavier : `Espace` (play/pause), `←/→` (prev/next), `R` (reset), `F` (plein écran)

## Déploiement Vercel

### Option 1 — via GitHub (recommandé)

1. Push le projet sur un dépôt GitHub
2. Sur [vercel.com/new](https://vercel.com/new), importer le repo
3. Vercel détecte automatiquement Vite, build et déploie. URL HTTPS générée.
4. Chaque push sur `main` redéploie automatiquement.

### Option 2 — via la CLI Vercel

```bash
npm install -g vercel
vercel login
vercel           # premier déploiement (preview)
vercel --prod    # déploiement production
```

## Structure

```
src/
├── App.tsx              # Layout principal + raccourcis clavier
├── main.tsx             # Entry point React
├── types.ts             # Types TS (Step, Sequence, BackupPayload)
├── store.ts             # Store Zustand persisté
├── App.css              # Styles globaux (Linear-inspired)
├── index.css            # Reset + globals
├── hooks/
│   └── useTimer.ts      # Logique du minuteur (interval, enchaînement)
├── lib/
│   ├── audio.ts         # Bip Web Audio API
│   ├── time.ts          # Format HH:MM, durée totale
│   └── uid.ts           # Générateur d'ID
└── components/
    ├── Icon.tsx         # SVG icons (lucide-style)
    ├── TopBar.tsx       # Barre du haut + actions I/O
    ├── Library.tsx      # Liste des séquences sauvegardées
    ├── Editor.tsx       # Édition de la séquence active
    ├── AddStepForm.tsx  # Formulaire d'ajout d'étape
    ├── StepItem.tsx     # Étape avec édition inline + drag handle
    ├── Timer.tsx        # Affichage du minuteur + contrôles
    └── Toast.tsx        # Notifications discrètes
```
