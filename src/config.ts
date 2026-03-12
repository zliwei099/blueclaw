import { resolve } from "node:path";

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const config = {
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST ?? "0.0.0.0",
  workspaceRoot: resolve(process.env.WORKSPACE_ROOT ?? process.cwd()),
  commandTimeoutMs: toInt(process.env.COMMAND_TIMEOUT_MS, 10_000),
  commandOutputLimit: toInt(process.env.COMMAND_OUTPUT_LIMIT, 8_192),
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? "",
    appSecret: process.env.FEISHU_APP_SECRET ?? "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
    botName: process.env.FEISHU_BOT_NAME ?? "blueclaw"
  }
};
