import { normalize, resolve } from "node:path";

const BLOCKED_TOKENS = ["&&", "||", "|", ";", "$(", "`", ">", "<"];
const ALLOWED_COMMANDS = new Set([
  "pwd",
  "ls",
  "cat",
  "echo",
  "rg",
  "git",
  "node",
  "npm",
  "pnpm",
  "python",
  "python3"
]);

export type PolicyDecision =
  | { ok: true; cwd: string }
  | { ok: false; reason: string };

export const validateCommand = (
  command: string,
  workspaceRoot: string,
  cwd?: string
): PolicyDecision => {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: "command is empty" };
  }

  if (BLOCKED_TOKENS.some((token) => trimmed.includes(token))) {
    return { ok: false, reason: "command contains blocked shell operators" };
  }

  const [binary] = trimmed.split(/\s+/, 1);
  if (!binary || !ALLOWED_COMMANDS.has(binary)) {
    return { ok: false, reason: `command '${binary ?? ""}' is not allowed` };
  }

  const targetCwd = resolve(workspaceRoot, cwd ?? ".");
  const normalizedRoot = ensureTrailingSeparator(resolve(workspaceRoot));
  const normalizedCwd = ensureTrailingSeparator(normalize(targetCwd));

  if (!normalizedCwd.startsWith(normalizedRoot)) {
    return { ok: false, reason: "cwd is outside workspace root" };
  }

  return { ok: true, cwd: targetCwd };
};

const ensureTrailingSeparator = (value: string): string =>
  value.endsWith("/") ? value : `${value}/`;
