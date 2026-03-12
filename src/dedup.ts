import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "./config.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_IDS = 1000;
const seenMessages = new Map<string, number>();
const storePath = join(config.sessionStoreDir, "seen-messages.json");
let initialized = false;
let persistPromise: Promise<void> | null = null;

const cleanup = (): void => {
  const now = Date.now();
  for (const [messageId, expiresAt] of seenMessages.entries()) {
    if (expiresAt <= now) {
      seenMessages.delete(messageId);
    }
  }

  if (seenMessages.size <= MAX_IDS) {
    return;
  }

  const sorted = [...seenMessages.entries()].sort((a, b) => a[1] - b[1]);
  for (const [messageId] of sorted.slice(0, seenMessages.size - MAX_IDS)) {
    seenMessages.delete(messageId);
  }
};

const persist = async (): Promise<void> => {
  cleanup();
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(
      {
        messages: [...seenMessages.entries()].map(([messageId, expiresAt]) => ({
          messageId,
          expiresAt
        }))
      },
      null,
      2
    ),
    "utf8"
  );
};

const ensureInitialized = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  initialized = true;

  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as {
      messages?: Array<{ messageId: string; expiresAt: number }>;
    };

    for (const entry of parsed.messages ?? []) {
      if (entry.expiresAt > Date.now()) {
        seenMessages.set(entry.messageId, entry.expiresAt);
      }
    }
  } catch {
    // ignore missing or invalid cache
  }
};

export const markMessageSeen = async (messageId?: string): Promise<boolean> => {
  if (!messageId) {
    return false;
  }

  await ensureInitialized();
  cleanup();

  if (seenMessages.has(messageId)) {
    return true;
  }

  seenMessages.set(messageId, Date.now() + CACHE_TTL_MS);

  persistPromise ??= persist().finally(() => {
    persistPromise = null;
  });
  await persistPromise;

  return false;
};
