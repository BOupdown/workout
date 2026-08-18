# Workout

Suivi de séances de musculation. Poids et répétitions, série par série, pour voir
sa progression sur un même exercice dans le temps.

Pensé pour un usage réel : en salle, téléphone à une main, entre deux séries.
**Enregistrer une série demande deux taps** quand l'exercice est déjà dans la
séance, et un seul pour la répéter à l'identique.

Toutes les données restent sur l'appareil, dans IndexedDB. Pas de compte, pas de
serveur, aucune donnée envoyée nulle part.

## Démarrer

```bash
npm install
npm run dev
```

| Commande | Effet |
|---|---|
| `npm run dev` | serveur de développement |
| `npm test` | suite de tests (Vitest + fake-indexeddb) |
| `npm run build` | build de production |
| `npm run lint` | ESLint |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Dexie 4
(IndexedDB) · Vitest.

## Organisation

```
app/                routes : séance, historique, progression, réglages
components/         écrans et composants, par domaine
hooks/              live queries Dexie et état de saisie
lib/db/             modèle, schéma, validation, couches d'écriture
lib/                logique pure : formats, brouillons, progression
test/               321 tests, tous en environnement Node
```

## Principes du code

Trois règles portent l'essentiel de l'architecture.

**IndexedDB est la seule source de vérité.** `useLiveQuery` rejoue les requêtes
après chaque écriture ; il n'existe aucune copie des données côté React, donc
rien à invalider ni à resynchroniser.

**Dériver plutôt que valider.** Les champs dénormalisés (`sessionId`,
`exerciseId`, `performedAt`, `order`, `nameKey`) n'apparaissent dans aucun type
d'entrée : ils sont recalculés depuis les entités parentes. Un appelant ne peut
pas les désynchroniser, il n'y a donc rien à vérifier.

**Deux niveaux de validation, imposés par Dexie.** Les hooks `creating` /
`updating` sont synchrones : ils ne vérifient que ce qui ne demande aucune
lecture (types, bornes, énumérations, cohérence entre deux champs d'une même
ligne). Les invariants qui dépendent d'une autre entité — charge attendue ou non
selon l'exercice, exercice archivé, modification d'un exercice déjà utilisé —
vivent dans les couches transactionnelles de `lib/db/`.

Conséquence utile : `setFieldRequirements()` est la source unique dont dérivent
*à la fois* la validation et les champs affichés à la saisie. L'écran ne peut pas
produire une série que la base refuserait.

## Sauvegarde

Les données vivent dans un seul navigateur, sur un seul appareil. Vider les
données du site les efface définitivement.

L'onglet **Réglages** exporte toute la base dans un fichier JSON et la restaure.
La restauration remplace tout et se joue dans une seule transaction : si le
fichier contient une ligne invalide, rien n'est écrit et les données existantes
restent intactes.
