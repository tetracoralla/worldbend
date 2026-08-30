// Versioned locale preference persistence: serialized queued writes so a
// burst of language switches persists in order and only the latest switch
// can report a save failure.

import {
  parseStoredLocalePreference,
  type LocalePreference,
  type StoredPreferencesV1,
} from "./i18n";

export interface LocaleStorage {
  read(): Promise<unknown>;
  write(record: StoredPreferencesV1): Promise<void>;
}

export function createLocalePreferenceSettings(storage: LocaleStorage) {
  let writeGeneration = 0;
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async readStoredPreference(): Promise<LocalePreference> {
      try {
        return parseStoredLocalePreference(await storage.read());
      } catch {
        return "system";
      }
    },
    queueWrite(preference: LocalePreference, onWriteFailed: () => void): void {
      const generation = ++writeGeneration;
      const record: StoredPreferencesV1 = { version: 1, locale: preference };
      const write = writeQueue.then(() => storage.write(record));
      writeQueue = write.catch(() => undefined);
      void write.catch(() => {
        if (generation === writeGeneration) onWriteFailed();
      });
    },
  };
}
