import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "../config.js";

export type AgentMemory = {
  operatorProfile: string[];
  preferences: string[];
  environmentFacts: string[];
  evolutionNotes: string[];
  updatedAt: string;
};

const memoryPath = join(config.sessionStoreDir, "agent-memory.json");

const createEmptyAgentMemory = (): AgentMemory => ({
  operatorProfile: [],
  preferences: [],
  environmentFacts: [],
  evolutionNotes: [],
  updatedAt: new Date(0).toISOString()
});

const normalizeList = (values: string[], maxSize: number): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result.slice(-maxSize);
};

export const loadAgentMemory = async (): Promise<AgentMemory> => {
  try {
    const raw = await readFile(memoryPath, "utf8");
    const payload = JSON.parse(raw) as Partial<AgentMemory>;
    return {
      operatorProfile: normalizeList(payload.operatorProfile ?? [], 12),
      preferences: normalizeList(payload.preferences ?? [], 12),
      environmentFacts: normalizeList(payload.environmentFacts ?? [], 12),
      evolutionNotes: normalizeList(payload.evolutionNotes ?? [], 16),
      updatedAt: payload.updatedAt ?? new Date().toISOString()
    };
  } catch {
    return createEmptyAgentMemory();
  }
};

export const saveAgentMemory = async (memory: AgentMemory): Promise<void> => {
  await mkdir(dirname(memoryPath), { recursive: true });
  await writeFile(
    memoryPath,
    JSON.stringify(
      {
        ...memory,
        operatorProfile: normalizeList(memory.operatorProfile, 12),
        preferences: normalizeList(memory.preferences, 12),
        environmentFacts: normalizeList(memory.environmentFacts, 12),
        evolutionNotes: normalizeList(memory.evolutionNotes, 16),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};

export const rememberAgentItems = async ({
  category,
  items
}: {
  category: "operatorProfile" | "preferences" | "environmentFacts" | "evolutionNotes";
  items: string[];
}): Promise<AgentMemory> => {
  const current = await loadAgentMemory();
  const next: AgentMemory = {
    ...current,
    [category]: normalizeList([...(current[category] ?? []), ...items], category === "evolutionNotes" ? 16 : 12),
    updatedAt: new Date().toISOString()
  };
  await saveAgentMemory(next);
  return next;
};

export const formatAgentMemory = (memory: AgentMemory): string =>
  [
    ...memory.operatorProfile.map((item) => `- operator profile: ${item}`),
    ...memory.preferences.map((item) => `- preference: ${item}`),
    ...memory.environmentFacts.map((item) => `- environment: ${item}`),
    ...memory.evolutionNotes.map((item) => `- evolution note: ${item}`)
  ].join("\n");
