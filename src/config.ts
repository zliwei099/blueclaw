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
  workspaceRoot: resolveWorkspaceRoot(process.env.WORKSPACE_ROOT),
  commandTimeoutMs: toInt(process.env.COMMAND_TIMEOUT_MS, 10_000),
  commandOutputLimit: toInt(process.env.COMMAND_OUTPUT_LIMIT, 8_192),
  sessionStoreDir: resolve(expandHomeDir(process.env.SESSION_STORE_DIR ?? ".blueclaw/sessions")),
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? "",
    appSecret: process.env.FEISHU_APP_SECRET ?? "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
    botName: process.env.FEISHU_BOT_NAME ?? "blueclaw",
    eventMode: process.env.FEISHU_EVENT_MODE ?? "websocket"
  },
  llm: {
    provider: process.env.LLM_PROVIDER ?? "openai-compatible",
    baseUrl: process.env.LLM_BASE_URL ?? "",
    apiKey: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "",
    maxSteps: toInt(process.env.LLM_MAX_STEPS, 4)
  }
};

function resolveWorkspaceRoot(value: string | undefined): string {
  const fallback = process.cwd();
  const candidate = resolve(expandHomeDir(value ?? fallback));
  return existsSync(candidate) ? candidate : fallback;
}
