import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "../config.js";
import { ChatMessage } from "../types.js";

export type SessionMemory = {
  preferredName?: string;
  profile: string[];
  preferences: string[];
  activeGoals: string[];
  updatedAt: string;
};

type SessionPayload = {
  sessionId: string;
  messages: ChatMessage[];
  memory?: SessionMemory;
  updatedAt: string;
};

const sessionPath = (sessionId: string): string =>
  join(config.sessionStoreDir, `${sanitize(sessionId)}.json`);

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const createEmptyMemory = (): SessionMemory => ({
  profile: [],
  preferences: [],
  activeGoals: [],
  updatedAt: new Date(0).toISOString()
});

const clampList = (items: string[], maxSize: number): string[] =>
  items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-maxSize);

const mergeUnique = (current: string[], additions: string[], maxSize: number): string[] => {
  const seen = new Set(current.map((item) => item.toLocaleLowerCase("zh-CN")));
  const merged = [...current];

  for (const addition of additions) {
    const value = addition.trim();
    if (!value) {
      continue;
    }

    const key = value.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(value);
  }

  return clampList(merged, maxSize);
};

const cleanSnippet = (value: string): string =>
  value
    .trim()
    .replace(/^是/, "")
    .replace(/[。.!！？,，；;]+$/g, "")
    .trim();

const collectMatches = (input: string, patterns: RegExp[]): string[] =>
  patterns
    .flatMap((pattern) => Array.from(input.matchAll(pattern), (match) => cleanSnippet(match[1] ?? "")))
    .filter(Boolean);

export const extractSessionMemory = (input: string): Partial<SessionMemory> => {
  const preferredName =
    collectMatches(input, [
      /(?:我叫|叫我)([^\s，。,.!！?？]{1,20})/g
    ])[0] ?? undefined;

  const profile = collectMatches(input, [
    /我是一个?([^，。.!！？\n]{1,40})/g,
    /我的角色是([^，。.!！？\n]{1,40})/g,
    /我的工作是([^，。.!！？\n]{1,40})/g
  ]);

  const preferences = collectMatches(input, [
    /(请用[^，。.!！？\n]{1,40})/g,
    /(默认用[^，。.!！？\n]{1,40})/g,
    /(我更喜欢[^，。.!！？\n]{1,40})/g,
    /(我喜欢[^，。.!！？\n]{1,40})/g,
    /(不要[^，。.!！？\n]{1,40})/g
  ]);

  const activeGoals = collectMatches(input, [
    /(我在做[^，。.!！？\n]{1,60})/g,
    /(我正在做[^，。.!！？\n]{1,60})/g,
    /(当前任务是[^，。.!！？\n]{1,60})/g,
    /(这次任务是[^，。.!！？\n]{1,60})/g,
    /(目标是[^，。.!！？\n]{1,60})/g
  ]);

  return {
    preferredName,
    profile,
    preferences,
    activeGoals
  };
};

export const mergeSessionMemory = (
  current: SessionMemory | undefined,
  patch: Partial<SessionMemory>
): SessionMemory => {
  const base = current ?? createEmptyMemory();

  return {
    preferredName: patch.preferredName ?? base.preferredName,
    profile: mergeUnique(base.profile, patch.profile ?? [], 8),
    preferences: mergeUnique(base.preferences, patch.preferences ?? [], 8),
    activeGoals: mergeUnique(base.activeGoals, patch.activeGoals ?? [], 8),
    updatedAt: new Date().toISOString()
  };
};

export const formatSessionMemory = (memory: SessionMemory): string => {
  const lines = [
    memory.preferredName ? `- 用户偏好称呼: ${memory.preferredName}` : "",
    ...memory.profile.map((item) => `- 用户背景: ${item}`),
    ...memory.preferences.map((item) => `- 用户偏好: ${item}`),
    ...memory.activeGoals.map((item) => `- 用户当前目标: ${item}`)
  ].filter(Boolean);

  return lines.join("\n");
};

export const loadSessionState = async (
  sessionId: string
): Promise<{ messages: ChatMessage[]; memory: SessionMemory }> => {
  const path = sessionPath(sessionId);

  try {
    const raw = await readFile(path, "utf8");
    const payload = JSON.parse(raw) as SessionPayload;
    return {
      messages: payload.messages ?? [],
      memory: mergeSessionMemory(payload.memory, {})
    };
  } catch {
    return {
      messages: [],
      memory: createEmptyMemory()
    };
  }
};

export const loadSessionMessages = async (sessionId: string): Promise<ChatMessage[]> => {
  const state = await loadSessionState(sessionId);
  return state.messages;
};

export const saveSessionMessages = async (
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> => {
  const state = await loadSessionState(sessionId);
  await saveSessionState(sessionId, {
    messages,
    memory: state.memory
  });
};

export const saveSessionState = async (
  sessionId: string,
  state: { messages: ChatMessage[]; memory: SessionMemory }
): Promise<void> => {
  const path = sessionPath(sessionId);
  await mkdir(dirname(path), { recursive: true });

  const payload: SessionPayload = {
    sessionId,
    messages: state.messages.slice(-24),
    memory: state.memory,
    updatedAt: new Date().toISOString()
  };

  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
};
