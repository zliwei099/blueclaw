import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "../../config.js";

export type CodexRuntimeState = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  recentUserInputs: string[];
  recentToolNames: string[];
  lastResponseType?: "final" | "tool_calls";
  lastResponsePreview?: string;
};

const runtimePath = (sessionId: string): string =>
  join(config.sessionStoreDir, "codex-runtime", `${sanitize(sessionId)}.json`);
const runtimeDir = join(config.sessionStoreDir, "codex-runtime");
const runtimeLogPath = join(runtimeDir, "events.log");

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const emptyState = (sessionId: string): CodexRuntimeState => ({
  sessionId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  turnCount: 0,
  recentUserInputs: [],
  recentToolNames: []
});

const clamp = (items: string[], maxSize: number): string[] => items.filter(Boolean).slice(-maxSize);

export const loadCodexRuntimeState = async (sessionId: string): Promise<CodexRuntimeState> => {
  try {
    const raw = await readFile(runtimePath(sessionId), "utf8");
    const parsed = JSON.parse(raw) as CodexRuntimeState;
    return {
      ...emptyState(sessionId),
      ...parsed,
      recentUserInputs: clamp(parsed.recentUserInputs ?? [], 8),
      recentToolNames: clamp(parsed.recentToolNames ?? [], 12)
    };
  } catch {
    return emptyState(sessionId);
  }
};

export const saveCodexRuntimeState = async (state: CodexRuntimeState): Promise<void> => {
  const path = runtimePath(state.sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        ...state,
        recentUserInputs: clamp(state.recentUserInputs, 8),
        recentToolNames: clamp(state.recentToolNames, 12),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};

export const summarizeCodexRuntimeState = (state: CodexRuntimeState): string =>
  [
    `sessionId: ${state.sessionId}`,
    `turnCount: ${state.turnCount}`,
    state.lastResponseType ? `lastResponseType: ${state.lastResponseType}` : "",
    state.lastResponsePreview ? `lastResponsePreview: ${state.lastResponsePreview}` : "",
    state.recentUserInputs.length ? `recentUserInputs: ${JSON.stringify(state.recentUserInputs)}` : "",
    state.recentToolNames.length ? `recentToolNames: ${JSON.stringify(state.recentToolNames)}` : ""
  ]
    .filter(Boolean)
    .join("\n");

export const appendCodexRuntimeEvent = async ({
  sessionId,
  type,
  detail
}: {
  sessionId: string;
  type: string;
  detail: string;
}): Promise<void> => {
  await mkdir(dirname(runtimeLogPath), { recursive: true });
  await appendFile(
    runtimeLogPath,
    JSON.stringify({
      at: new Date().toISOString(),
      sessionId,
      type,
      detail: detail.slice(0, 500)
    }) + "\n",
    "utf8"
  );
};

export const listCodexRuntimeStates = async (): Promise<CodexRuntimeState[]> => {
  try {
    const entries = await readdir(runtimeDir);
    const states = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const raw = await readFile(join(runtimeDir, entry), "utf8");
            return JSON.parse(raw) as CodexRuntimeState;
          } catch {
            return undefined;
          }
        })
    );

    return states
      .filter((state): state is CodexRuntimeState => Boolean(state))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
};

export const loadRecentCodexRuntimeEvents = async (limit = 40): Promise<
  Array<{
    at: string;
    sessionId: string;
    type: string;
    detail: string;
  }>
> => {
  try {
    const raw = await readFile(runtimeLogPath, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as { at: string; sessionId: string; type: string; detail: string });
  } catch {
    return [];
  }
};
