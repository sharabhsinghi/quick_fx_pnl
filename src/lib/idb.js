const DB_NAME = 'fx-tracker';
const DB_VERSION = 1;

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('trades')) {
        db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

function wrap(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = (e) => resolve(e.target.result);
    idbRequest.onerror = (e) => reject(e.target.error);
  });
}

export async function getTrades() {
  const db = await openDb();
  const tx = db.transaction('trades', 'readonly');
  const all = await wrap(tx.objectStore('trades').getAll());
  return all.sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
}

export async function addTrade(trade) {
  const db = await openDb();
  const tx = db.transaction('trades', 'readwrite');
  return wrap(tx.objectStore('trades').add(trade));
}

export async function deleteTrade(id) {
  const db = await openDb();
  const tx = db.transaction('trades', 'readwrite');
  return wrap(tx.objectStore('trades').delete(id));
}

export async function getHistory() {
  const db = await openDb();
  const tx = db.transaction('history', 'readonly');
  const all = await wrap(tx.objectStore('history').getAll());
  return all.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
}

export async function addHistory(entry) {
  const db = await openDb();
  const tx = db.transaction('history', 'readwrite');
  return wrap(tx.objectStore('history').add(entry));
}

export async function deleteHistory(id) {
  const db = await openDb();
  const tx = db.transaction('history', 'readwrite');
  return wrap(tx.objectStore('history').delete(id));
}

export async function clearHistory() {
  const db = await openDb();
  const tx = db.transaction('history', 'readwrite');
  return wrap(tx.objectStore('history').clear());
}

export async function getSettings() {
  const db = await openDb();
  const tx = db.transaction('settings', 'readonly');
  const all = await wrap(tx.objectStore('settings').getAll());
  const map = Object.fromEntries(all.map(r => [r.key, r.value]));
  return {
    size: parseFloat(map.account_size) || 10000,
    currency: map.account_currency || 'USD',
  };
}

export async function saveSettings({ size, currency }) {
  const db = await openDb();
  const tx = db.transaction('settings', 'readwrite');
  const store = tx.objectStore('settings');
  await wrap(store.put({ key: 'account_size', value: String(size) }));
  await wrap(store.put({ key: 'account_currency', value: String(currency) }));
}

export async function getApiKey() {
  const db = await openDb();
  const tx = db.transaction('settings', 'readonly');
  const row = await wrap(tx.objectStore('settings').get('twelve_api_key'));
  return row?.value || '';
}

export async function saveApiKey(key) {
  const db = await openDb();
  const tx = db.transaction('settings', 'readwrite');
  await wrap(tx.objectStore('settings').put({ key: 'twelve_api_key', value: String(key) }));
}
