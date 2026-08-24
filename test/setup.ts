/**
 * Installs an in-memory IndexedDB on the globals, before Dexie is imported.
 *
 * Dexie probes the engine's capabilities when it loads — the supported `maxKey`
 * bound among them — which is why this import comes first of all.
 */
import 'fake-indexeddb/auto';
