import { homedir } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const expandHomeDir = (value: string): string => {
  if (value === "~") {
    return homedir();
  }

  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }

  return value;
};

export const config = {
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST ?? "127.0.0.1",
  projectRoot: process.cwd(),
  workspaceRoot: resolveWorkspaceRoot(process.env.WORKSPACE_ROOT),
  commandTimeoutMs: toInt(process.env.COMMAND_TIMEOUT_MS, 10_000),
  commandOutputLimit: toInt(process.env.COMMAND_OUTPUT_LIMIT, 8_192),
  sessionStoreDir: resolve(expandHomeDir(process.env.SESSION_STORE_DIR ?? ".blueclaw/sessions")),
  skillRoots: resolveRoots(
    process.env.AGENT_SKILL_ROOTS,
    [resolve(homedir(), ".codex/skills/.system"), resolve(process.cwd(), "skills")].filter((value) => existsSync(value))
  ),
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? "",
    appSecret: process.env.FEISHU_APP_SECRET ?? "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
    botName: process.env.FEISHU_BOT_NAME ?? "blueclaw",
    eventMode: process.env.FEISHU_EVENT_MODE ?? "websocket",
    processingEmojiType: process.env.FEISHU_PROCESSING_EMOJI_TYPE ?? ""
  },
  llm: {
    provider: process.env.LLM_PROVIDER ?? "openai-compatible",
    baseUrl: process.env.LLM_BASE_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "",
    maxSteps: toInt(process.env.LLM_MAX_STEPS, 4),
    codexBin: process.env.LLM_CODEX_BIN ?? "codex",
    codexSandbox: process.env.LLM_CODEX_SANDBOX ?? "workspace-write",
    codexFullAuto: (process.env.LLM_CODEX_FULL_AUTO ?? "true") !== "false"
  }
};

function resolveRoots(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => resolve(expandHomeDir(item.trim())))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .filter((item) => existsSync(item));
}

function resolveWorkspaceRoot(value: string | undefined): string {
  const fallback = process.cwd();
  const candidate = resolve(expandHomeDir(value ?? fallback));
  if (!existsSync(candidate)) {
    return fallback;
  }

  if (existsSync(resolve(candidate, ".git"))) {
    return candidate;
  }

  if (existsSync(resolve(fallback, ".git"))) {
    return fallback;
  }

  return candidate;
}
