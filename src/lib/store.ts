import { load } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";

let storePromise: ReturnType<typeof load> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = load(STORE_PATH, { autoSave: true, defaults: {} });
  }
  return storePromise;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const store = await getStore();
    const val = await store.get<T>(key);
    return val ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
  } catch {
    // Silently fail — settings are non-critical
  }
}
