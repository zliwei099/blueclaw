import { config } from "../config.js";
import { validateCommand } from "../security/policy.js";
import { executeShellCommand } from "../tools/shell.js";
import { CommandExecutionResult } from "../types.js";

export const runCommand = async (
  command: string,
  cwd?: string
): Promise<
  | { ok: true; result: CommandExecutionResult; cwd: string }
  | { ok: false; reason: string }
> => {
  const decision = validateCommand(command, config.workspaceRoot, cwd);
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason
    };
  }

  const result = await executeShellCommand({
    command,
    cwd: decision.cwd,
    timeoutMs: config.commandTimeoutMs,
    outputLimit: config.commandOutputLimit
  });

  return {
    ok: true,
    result,
    cwd: decision.cwd
  };
};
