export type CalculationDebugEntry = {
  id: string;
  timestamp: string;
  message: string;
};

const STORAGE_KEY = "roofmeasure.calculation-debug";
const EVENT_NAME = "roofmeasure:calculation-debug";
const MAX_ENTRIES = 40;

let entries: CalculationDebugEntry[] = [];
let initialized = false;

function loadEntries() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as CalculationDebugEntry[]) : [];
    entries = Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    entries = [];
  }
}

function persistEntries() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Debug logging must never interfere with calculation or local persistence.
  }
}

export function getCalculationDebugEntries() {
  loadEntries();
  return entries;
}

export function appendCalculationDebugNote(message: string) {
  if (typeof window === "undefined") return;
  loadEntries();

  entries = [
    ...entries,
    {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message,
    },
  ].slice(-MAX_ENTRIES);
  persistEntries();
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function clearCalculationDebugEntries() {
  if (typeof window === "undefined") return;
  loadEntries();
  entries = [];

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Debug logging must never interfere with calculation or local persistence.
  }

  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeToCalculationDebugNotes(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
