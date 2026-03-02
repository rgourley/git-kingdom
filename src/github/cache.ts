// ─── IndexedDB Cache Layer ──────────────────────────────────────
// Persistent cache with larger storage than localStorage (~50MB+).
// Used as a secondary tier behind localStorage for stale-while-revalidate.

const DB_NAME = 'gk_cache';
const STORE_NAME = 'api_cache';
const DB_VERSION = 1;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Get a value from IndexedDB if it exists and is within the TTL */
export async function idbGet<T>(key: string, ttl: number): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry || Date.now() - entry.ts > ttl) {
          resolve(null);
        } else {
          resolve(entry.data);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Get a value from IndexedDB regardless of TTL (for stale-while-revalidate) */
export async function idbGetStale<T>(key: string): Promise<{ data: T; ts: number } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry) {
          resolve(null);
        } else {
          resolve({ data: entry.data, ts: entry.ts });
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Store a value in IndexedDB */
export async function idbSet(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ data, ts: Date.now() } as CacheEntry<unknown>, key);
  } catch { /* storage full or IDB unavailable — ignore */ }
}
