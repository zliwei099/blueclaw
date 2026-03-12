import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CommandExecutionResult } from "../types.js";

const execFileAsync = promisify(execFile);

const truncate = (
  value: string,
  maxLength: number
): { text: string; truncated: boolean } => {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }

  return {
    text: `${value.slice(0, maxLength)}\n...[truncated]`,
    truncated: true
  };
};

export const executeShellCommand = async ({
  command,
  cwd,
  timeoutMs,
  outputLimit
}: {
  command: string;
  cwd: string;
  timeoutMs: number;
  outputLimit: number;
}): Promise<CommandExecutionResult> => {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: outputLimit * 4
    });

    const stdoutResult = truncate(stdout, outputLimit);
    const stderrResult = truncate(stderr, outputLimit);

    return {
      ok: true,
      exitCode: 0,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      durationMs: Date.now() - startedAt,
      truncated: stdoutResult.truncated || stderrResult.truncated
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: NodeJS.Signals;
    };

    const stdoutResult = truncate(failure.stdout ?? "", outputLimit);
    const stderrResult = truncate(failure.stderr ?? failure.message, outputLimit);

    return {
      ok: false,
      exitCode: typeof failure.code === "number" ? failure.code : null,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      durationMs,
      truncated: stdoutResult.truncated || stderrResult.truncated
    };
  }
};
