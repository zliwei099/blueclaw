import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "../config.js";
import { ChatMessage } from "../types.js";

type SessionPayload = {
  sessionId: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const sessionPath = (sessionId: string): string =>
  join(config.sessionStoreDir, `${sanitize(sessionId)}.json`);

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_");

export const loadSessionMessages = async (sessionId: string): Promise<ChatMessage[]> => {
  const path = sessionPath(sessionId);

  try {
    const raw = await readFile(path, "utf8");
    const payload = JSON.parse(raw) as SessionPayload;
    return payload.messages ?? [];
  } catch {
    return [];
  }
};

export const saveSessionMessages = async (
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> => {
  const path = sessionPath(sessionId);
  await mkdir(dirname(path), { recursive: true });

  const payload: SessionPayload = {
    sessionId,
    messages: messages.slice(-20),
    updatedAt: new Date().toISOString()
  };

  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
};
