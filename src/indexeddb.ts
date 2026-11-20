import type { OfflineOperation, OfflineStore } from './offline.js';

/** Creates a browser store with atomic operation transitions across tabs. */
export function createIndexedDbStore<Args>(
  databaseName: string,
): OfflineStore<Args> {
  const storeName = 'operations';

  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore(storeName, { keyPath: 'key' })
          .createIndex('scope', 'scope');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function transaction<T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore, setResult: (result: T) => void) => void,
  ): Promise<T> {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error);
        use(tx.objectStore(storeName), (value) => {
          result = value;
        });
      });
    } finally {
      db.close();
    }
  }

  return {
    add: (operation) =>
      transaction<void>('readwrite', (store) => {
        store.add(operation);
      }),
    list: (scope) =>
      transaction('readonly', (store, setResult) => {
        const request = store.index('scope').getAll(scope);
        request.onsuccess = () => setResult(request.result);
      }),
    update: (key, transition) =>
      transaction('readwrite', (store, setResult) => {
        const request = store.get(key) as IDBRequest<
          OfflineOperation<Args> | undefined
        >;
        request.onsuccess = () => {
          const operation = request.result;
          const next = operation && transition(operation);
          if (next) store.put(next);
          setResult(next);
        };
      }),
  };
}
