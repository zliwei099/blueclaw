import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FastifyBaseLogger } from "fastify";

import { config } from "./config.js";
import { scheduleServiceRestart } from "./service-control.js";
import { runCommand } from "./lib/command.js";

const statePath = join(config.sessionStoreDir, "release-state.json");
const execFileAsync = promisify(execFile);

type ReleaseState = {
  lastCommittedHead?: string;
  lastSuccessfulRestartHead?: string;
  updatedAt?: string;
};

const loadState = async (): Promise<ReleaseState> => {
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw) as ReleaseState;
  } catch {
    return {};
  }
};

const saveState = async (state: ReleaseState): Promise<void> => {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};

const runTrustedCommand = async (
  command: string
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> => {
  const outcome = await runCommand(command);
  if (!outcome.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: outcome.reason,
      exitCode: null
    };
  }

  return {
    ok: outcome.result.ok,
    stdout: outcome.result.stdout,
    stderr: outcome.result.stderr,
    exitCode: outcome.result.exitCode
  };
};

export const getDiffSummary = async (): Promise<string> => {
  const diffStat = await runTrustedCommand("git diff --stat");
  const status = await runTrustedCommand("git status --short");

  return [
    "git diff --stat:",
    diffStat.stdout.trim() || "(no unstaged diff stat)",
    "",
    "git status:",
    status.stdout.trim() || "(working tree clean)"
  ].join("\n");
};

export const createCommit = async ({
  message
}: {
  message: string;
}): Promise<string> => {
  const status = await runTrustedCommand("git status --short");
  if (!status.ok) {
    return `git status failed:\n${status.stderr}`;
  }

  if (!status.stdout.trim()) {
    return "working tree clean, nothing to commit.";
  }

  try {
    await execFileAsync("git", ["add", "."], {
      cwd: config.projectRoot,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return `git add failed:\n${failure.stderr || failure.stdout || failure.message}`;
  }

  let commitStdout = "";
  try {
    const result = await execFileAsync("git", ["commit", "-m", message], {
      cwd: config.projectRoot,
      maxBuffer: 1024 * 1024
    });
    commitStdout = result.stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return `git commit failed:\n${failure.stderr || failure.stdout || failure.message}`;
  }

  const head = await runTrustedCommand("git rev-parse --short HEAD");
  const state = await loadState();
  state.lastCommittedHead = head.stdout.trim();
  await saveState(state);

  return [
    commitStdout.trim() || "commit created.",
    `head: ${head.stdout.trim()}`
  ].join("\n");
};

export const restartWithBuildGate = async (logger: FastifyBaseLogger): Promise<string> => {
  const build = await runTrustedCommand("npm run build");
  if (!build.ok) {
    return [
      "restart blocked: build failed.",
      build.stdout.trim(),
      build.stderr.trim()
    ]
      .filter(Boolean)
      .join("\n");
  }

  const head = await runTrustedCommand("git rev-parse --short HEAD");
  const state = await loadState();
  state.lastSuccessfulRestartHead = head.stdout.trim();
  await saveState(state);

  const scheduled = scheduleServiceRestart(logger);
  if (!scheduled) {
    return "restart already in progress.";
  }

  return `build passed. blueclaw restarting from head ${head.stdout.trim()}.`;
};

export const rollbackToLastStable = async (): Promise<string> => {
  const state = await loadState();
  if (!state.lastSuccessfulRestartHead) {
    return "no recorded stable release to roll back to.";
  }

  try {
    await execFileAsync("git", ["checkout", state.lastSuccessfulRestartHead, "--", "."], {
      cwd: config.projectRoot,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return `rollback failed:\n${failure.stderr || failure.stdout || failure.message}`;
  }

  return `rolled back working tree to ${state.lastSuccessfulRestartHead}.`;
};
