# Schéma Supabase — Sequencer

Tout est isolé dans un **schéma dédié `sequencer`** pour ne pas polluer `public` (déjà utilisé par d'autres outils de la suite communautaire).

## Application du schéma

### Étape 1 — Exécuter le SQL

Dans Supabase Dashboard → **SQL Editor** → coller le contenu de [`migrations/0001_sequencer_schema.sql`](migrations/0001_sequencer_schema.sql) → **Run**.

Le script crée :
- Le schéma `sequencer`
- Le type enum `sequencer.live_status`
- Les tables `sequencer.sequences` et `sequencer.live_sessions`
- Les triggers `updated_at` + auto-incrément `version`
- Les grants pour `anon`, `authenticated`, `service_role`
- L'inscription à la publication Realtime
- Les policies RLS v1 (ouvertes)

### Étape 2 — ⚠️ Exposer le schéma à l'API

Par défaut, PostgREST n'expose que `public`. Il faut explicitement ajouter `sequencer` :

1. Dashboard Supabase → **Project Settings → API**
2. Section **"Data API Settings"** → champ **"Exposed schemas"**
3. Ajouter `sequencer` (en plus de `public`)
4. **Save**

Sans cette étape, le client JS Supabase recevra `404` ou `relation "sequencer.sequences" does not exist`.

### Méthode alternative — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <ton-ref-projet>
supabase db push
```

(L'exposition du schéma reste à faire manuellement dans le dashboard.)

## Utilisation côté client JS

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'sequencer' },   // ← important : pointe sur notre schéma dédié
});

// Toutes les requêtes ci-dessous tapent automatiquement dans `sequencer.*`
const { data } = await supabase.from('sequences').select('*');
const { data: lives } = await supabase
  .from('live_sessions')
  .select('*')
  .is('ended_at', null);
```

Pour tomber sur une autre table de `public` ponctuellement :

```ts
supabase.schema('public').from('autre_table').select('*');
```

## Structure des données

### `sequencer.sequences` — templates de séquences

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | Nom affiché |
| `steps` | jsonb | `[{name, duration (sec)}]` |
| `owner_id` | uuid | FK `auth.users` (nullable) |
| `org_id` | uuid | FK `organizations` (à brancher plus tard) |
| `created_at`, `updated_at` | timestamptz | Auto |

### `sequencer.live_sessions` — minuteurs en direct

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid | PK |
| `sequence_id` | uuid | FK source (nullable, snapshot reste autoritaire) |
| `sequence_snapshot` | jsonb | `{name, steps: [...]}` figé au Go Live |
| `title` | text | Titre affiché dans la liste |
| `status` | enum | `pending` / `running` / `paused` / `finished` |
| `effective_start_at` | timestamptz | Si `running` : référence de calcul de l'écoulé |
| `elapsed_at_pause_ms` | bigint | Si `paused` : ms écoulées au moment de la pause |
| `is_public` | bool | Visible dans la liste publique |
| `host_id`, `org_id` | uuid | Métadonnées |
| `version` | int | Auto-incrémenté à chaque update |
| `ended_at` | timestamptz | Non-null = clôturée |

### Modèle d'horloge (le cœur du système)

L'état de temps se réduit à **trois cas** :

```
status='pending'  → elapsed = 0
status='running'  → elapsed = now() - effective_start_at
status='paused'   → elapsed = elapsed_at_pause_ms
```

Tous les appareils calculent localement l'index d'étape et le temps restant à partir d'`elapsed`. La synchro est garantie sans pousser de tick par WebSocket.

**Actions** (mises à jour atomiques de la ligne) :

| Action | Mise à jour |
|---|---|
| **Play** depuis pending | `status='running', effective_start_at=now()` |
| **Play** depuis paused | `status='running', effective_start_at=now() - elapsed_at_pause_ms, elapsed_at_pause_ms=null` |
| **Pause** | `status='paused', elapsed_at_pause_ms = now() - effective_start_at, effective_start_at=null` |
| **Skip** étape (next/prev) | Recalculer le `elapsed` cible, ajuster `effective_start_at` ou `elapsed_at_pause_ms` |
| **Reset** | `status='pending', effective_start_at=null, elapsed_at_pause_ms=null` |
| **End** | `ended_at=now(), status='finished'` |

## Sécurité (RLS)

Le script applique par défaut les **policies v1 ouvertes** (lecture/écriture libre, pas d'auth requise) — adaptées au développement et à un usage single-tenant intranet.

**Quand l'auth + les organisations seront en place**, basculer vers les policies v2 (commentées dans le SQL) :

```sql
drop policy if exists "v1_sequences_all"  on sequencer.sequences;
drop policy if exists "v1_live_all"       on sequencer.live_sessions;
-- puis exécuter le bloc v2 du SQL
```

Les policies v2 supposent une table `public.org_members (user_id, org_id, role)` — à adapter selon ta structure.

## Realtime

Seule `sequencer.live_sessions` est dans la publication Realtime. Côté React :

```ts
supabase
  .channel(`live:${sessionId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'sequencer',                  // ← le schéma figure dans le filtre
    table: 'live_sessions',
    filter: `id=eq.${sessionId}`,
  }, (payload) => updateLocalState(payload.new))
  .subscribe();
```

Pour la liste de tous les lives actifs (page `/live`) :

```ts
supabase
  .channel('live:list')
  .on('postgres_changes', {
    event: '*',
    schema: 'sequencer',
    table: 'live_sessions',
  }, () => refetchList())
  .subscribe();
```

## Maintenance

Une fonction `sequencer.cleanup_stale_live_sessions()` ferme les lives oubliés (>24h sans modif). À planifier via `pg_cron` si tu l'actives :

```sql
select cron.schedule(
  'cleanup-stale-lives',
  '0 * * * *',  -- toutes les heures
  'select sequencer.cleanup_stale_live_sessions()'
);
```

## Génération des types TypeScript

Une fois le schéma en place :

```bash
supabase gen types typescript \
  --project-id <ref> \
  --schema sequencer \
  > src/lib/database.types.ts
```

Permet d'avoir des types stricts dans le client Supabase.

## Désinstallation propre

Pour tout supprimer (utile pendant le dev) :

```sql
drop schema sequencer cascade;
```

Tables, types, fonctions, triggers, indexes, policies — tout part en cascade.
