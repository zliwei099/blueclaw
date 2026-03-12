import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type CodexAuthPayload = {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  last_refresh?: string;
  tokens?: {
    account_id?: string;
    access_token?: string;
    id_token?: string;
  };
};

const authPath = join(homedir(), ".codex", "auth.json");

const mask = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const decodeJwtPayload = (token: string | undefined): Record<string, unknown> | undefined => {
  if (!token) {
    return undefined;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const maskEmail = (value: string | undefined): string | undefined => {
  if (!value || !value.includes("@")) {
    return value;
  }

  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return value;
  }

  return `${local.slice(0, 2)}***@${domain}`;
};

export const loadCodexProfileSummary = async (): Promise<{
  ok: boolean;
  authMode?: string;
  hasApiKey?: boolean;
  accountId?: string;
  email?: string;
  plan?: string;
  lastRefresh?: string;
  authPath: string;
  error?: string;
}> => {
  try {
    const raw = await readFile(authPath, "utf8");
    const payload = JSON.parse(raw) as CodexAuthPayload;
    const idClaims = decodeJwtPayload(payload.tokens?.id_token);
    const accessClaims = decodeJwtPayload(payload.tokens?.access_token);
    const authClaims =
      (idClaims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined) ??
      (accessClaims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined);

    return {
      ok: true,
      authMode: payload.auth_mode ?? "unknown",
      hasApiKey: Boolean(payload.OPENAI_API_KEY),
      accountId: mask(payload.tokens?.account_id),
      email: maskEmail((idClaims?.email as string | undefined) ?? (accessClaims?.email as string | undefined)),
      plan: (authClaims?.chatgpt_plan_type as string | undefined) ?? "unknown",
      lastRefresh: payload.last_refresh,
      authPath
    };
  } catch (error) {
    return {
      ok: false,
      authPath,
      error: error instanceof Error ? error.message : "unknown error"
    };
  }
};
