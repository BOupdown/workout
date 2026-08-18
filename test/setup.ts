/**
 * Installe un IndexedDB en mémoire sur les globales, avant tout import de Dexie.
 *
 * Dexie détecte les capacités du moteur au chargement (notamment la borne
 * `maxKey` supportée), d'où l'import en tout premier.
 */
import 'fake-indexeddb/auto';
