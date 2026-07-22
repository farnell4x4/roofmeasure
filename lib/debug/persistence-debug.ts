export type PersistenceDebugEntry = {
  id: string;
  timestamp: string;
  message: string;
};

const STORAGE_KEY = "roofmeasure.persistence-debug";
const EVENT_NAME = "roofmeasure:persistence-debug";
const MAX_ENTRIES = 80;

let entries: PersistenceDebugEntry[] = [];
let initialized = false;

function loadEntries() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as PersistenceDebugEntry[]) : [];
    entries = Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    entries = [];
  }
}

function persistEntries() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Debug logging must never interfere with local persistence.
  }
}

export function getPersistenceDebugEntries() {
  loadEntries();
  return entries;
}

export function appendPersistenceDebugNote(message: string) {
  if (typeof window === "undefined") return;
  loadEntries();

  const entry: PersistenceDebugEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message
  };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  persistEntries();
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function clearPersistenceDebugEntries() {
  if (typeof window === "undefined") return;
  loadEntries();
  entries = [];

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Debug logging must never interfere with local persistence.
  }

  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeToPersistenceDebugNotes(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
