const DB_NAME = "english-buddy-roleplay-audio";
const DB_VERSION = 1;
const STORE_NAME = "tts-audio";
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Kore";
const DEFAULT_STYLE = "natural-roleplay";
const DEFAULT_KEEP = 80;

export function normalizeTtsText(text) {
  return (text || "").trim().replace(/\s+/g, " ");
}

function hasIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("lastUsedAt", "lastUsedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function roleplayTtsCacheKey(
  text,
  {
    model = DEFAULT_MODEL,
    voice = DEFAULT_VOICE,
    style = DEFAULT_STYLE,
  } = {},
) {
  if (
    typeof crypto === "undefined" ||
    !crypto.subtle ||
    typeof TextEncoder === "undefined"
  ) {
    return "";
  }
  const normalized = normalizeTtsText(text);
  const raw = [model, voice, style, normalized].join("\n");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedRoleplayAudio(key) {
  if (!key) return null;
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise(store.get(key));
    if (record) {
      record.lastUsedAt = Date.now();
      store.put(record);
    }
    await txDone(tx);
    return record || null;
  } finally {
    db.close();
  }
}

export async function saveCachedRoleplayAudio(record, { keep = DEFAULT_KEEP } = {}) {
  if (!record?.key || !record?.blob) return;
  const db = await openDb();
  if (!db) return;
  try {
    const now = Date.now();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      ...record,
      createdAt: record.createdAt || now,
      lastUsedAt: now,
    });
    const all = await requestToPromise(store.getAll());
    const stale = all
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(Math.max(1, keep));
    for (const item of stale) store.delete(item.key);
    await txDone(tx);
  } finally {
    db.close();
  }
}
