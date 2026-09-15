# Test d’import JSON — 15 septembre 2026

Données synthétiques générées avec une graine fixe (20260915), pour un test aléatoire reproductible : 4 exercices, 6 séances, 18 blocs et 72 séries. Le fichier omet les tables facultatives pour représenter une ancienne sauvegarde version 1.

Le parseur JSON, l’import, les validations, la file d’envoi et le moteur de synchronisation sont ceux de l’application. IndexedDB est simulé avec fake-indexeddb ; le serveur est simulé en mémoire. Aucune donnée utilisateur ni aucun serveur réel n’ont été modifiés. Le simulateur reprend la contrainte SQL `unique (user_id, name_key)` sur les exercices, y compris les lignes supprimées logiquement. Il ne constitue pas un test de bout en bout contre Supabase.

## Résultats avant correction

| Situation | Résultat après 3 tentatives |
| --- | --- |
| Import avant la première synchronisation | Réussite : synced, 6 séances et 72 séries envoyées, file vide |
| Réimport avec les mêmes identifiants d’exercices | Réussite : synced, 6 séances et 72 séries envoyées, file vide |
| Import dans un compte initialisé, mêmes noms d’exercices mais identifiants différents | Échec : error, 6 séances et 72 séries locales, aucune séance ni série envoyée, 100 opérations en attente |

Cause reproduite : conflit `exercises_user_id_name_key_key`. La synchronisation tente d’insérer les exercices sous les identifiants du JSON alors que leur nom est déjà réservé par d’autres identifiants dans le compte. La suppression logique préalable ne libère pas cette contrainte. Le rapprochement des identifiants effectué lors de la première synchronisation ne s’exécute plus sur un compte déjà initialisé.

La sortie historique `test-results.txt` conserve cet échec avant correction.

## Correction

Le moteur de synchronisation rapproche maintenant les exercices en attente par leur nom normalisé avec le catalogue du compte, y compris les lignes supprimées logiquement. Les références des blocs, séries et routines et la file d’envoi sont corrigées dans une seule transaction. Les parents sont envoyés avant leurs références ; les autres suppressions demandées par la restauration sont conservées.

Les imports déjà bloqués sont repris à la prochaine synchronisation, sans réimport nécessaire. Le statut `synced` reste conditionné à un envoi et une lecture réussis.

Les tests permanents dans `test/workout-sync.test.tsx` couvrent le JSON initial, les imports déjà bloqués, le téléchargement depuis un autre appareil, les routines, les suppressions de la restauration, la pagination interrompue, les modifications pendant la lecture et l’annulation transactionnelle. Les 19 tests de ce fichier passent après correction.

```bash
npm test -- test/workout-sync.test.tsx
```

## Relancer le diagnostic original depuis la racine du projet

```bash
cp docs/import-sync-2026-09-15/reproduction.test.tsx.txt test/import-sync-diagnostic.test.tsx
npm test -- test/import-sync-diagnostic.test.tsx
rm test/import-sync-diagnostic.test.tsx
```

Le diagnostic original est conservé pour comparaison ; les régressions sont désormais couvertes par la suite courante. `test-results.txt` décrit uniquement la version antérieure au correctif.
