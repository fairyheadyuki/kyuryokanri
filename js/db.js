// IndexedDB の薄いラッパー。明細、画像(Blob)、設定の3ストアを持つ。
const DB_NAME = 'payslip-app';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('payslips', { keyPath: 'id' });
      d.createObjectStore('images');
      d.createObjectStore('settings');
    };
    req.onsuccess = () => {
      const d = req.result;
      // iOS はバックグラウンド中に接続を閉じることがあるので、次回開き直す
      d.onclose = () => { dbPromise = null; };
      resolve(d);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  let d = await open();
  let tx;
  try {
    tx = d.transaction(store, mode);
  } catch (err) {
    // 閉じられた接続を掴んでいた場合は1度だけ開き直す
    dbPromise = null;
    d = await open();
    tx = d.transaction(store, mode);
  }
  return new Promise((resolve, reject) => {
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  payslips: {
    all: () => run('payslips', 'readonly', (s) => s.getAll()),
    get: (id) => run('payslips', 'readonly', (s) => s.get(id)),
    put: (p) => run('payslips', 'readwrite', (s) => s.put(p)),
    del: (id) => run('payslips', 'readwrite', (s) => s.delete(id)),
  },
  images: {
    allKeys: () => run('images', 'readonly', (s) => s.getAllKeys()),
    get: (id) => run('images', 'readonly', (s) => s.get(id)),
    put: (id, blob) => run('images', 'readwrite', (s) => s.put(blob, id)),
    del: (id) => run('images', 'readwrite', (s) => s.delete(id)),
  },
  settings: {
    get: (key) => run('settings', 'readonly', (s) => s.get(key)),
    set: (key, value) => run('settings', 'readwrite', (s) => s.put(value, key)),
    del: (key) => run('settings', 'readwrite', (s) => s.delete(key)),
  },
};

// パスコードを忘れたときの初期化用
export async function wipeAll() {
  const d = await open();
  d.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
