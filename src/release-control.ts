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
  lastPushedHead?: string;
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

const runGitExec = async (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  try {
    const result = await execFileAsync("git", args, {
      cwd: config.projectRoot,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return {
      ok: false,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message
    };
  }
};

const runVerificationSummary = async (): Promise<string> => {
  const check = await runTrustedCommand("npm run check");
  const build = await runTrustedCommand("npm run build");

  const lines = [
    "verification:",
    `- check: ${check.ok ? "ok" : "failed"}`,
    `- build: ${build.ok ? "ok" : "failed"}`
  ];

  if (!check.ok) {
    lines.push(check.stderr.trim() || check.stdout.trim());
  }

  if (!build.ok) {
    lines.push(build.stderr.trim() || build.stdout.trim());
  }

  return lines.filter(Boolean).join("\n");
};

export const getDiffSummary = async (): Promise<string> => {
  const diffStat = await runTrustedCommand("git diff --stat");
  const status = await runTrustedCommand("git status --short");
  const branch = await runTrustedCommand("git status --short --branch");

  return [
    branch.stdout.split("\n")[0]?.trim() || "branch: unknown",
    "",
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
  const verification = await runVerificationSummary();
  if (verification.includes("failed")) {
    return [
      "commit blocked: verification failed.",
      verification
    ].join("\n\n");
  }

  const status = await runTrustedCommand("git status --short");
  if (!status.ok) {
    return `git status failed:\n${status.stderr}`;
  }

  if (!status.stdout.trim()) {
    return "working tree clean, nothing to commit.";
  }

  const add = await runGitExec(["add", "."]);
  if (!add.ok) {
    return `git add failed:\n${add.stderr || add.stdout}`;
  }

  const commit = await runGitExec(["commit", "-m", message]);
  if (!commit.ok) {
    return `git commit failed:\n${commit.stderr || commit.stdout}`;
  }

  const head = await runTrustedCommand("git rev-parse --short HEAD");
  const state = await loadState();
  state.lastCommittedHead = head.stdout.trim();
  await saveState(state);

  return [
    verification,
    "",
    commit.stdout.trim() || "commit created.",
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

export const pushCurrentBranch = async (): Promise<string> => {
  const status = await runTrustedCommand("git status --short");
  if (!status.ok) {
    return `git status failed:\n${status.stderr}`;
  }

  if (status.stdout.trim()) {
    return [
      "push blocked: working tree is not clean.",
      status.stdout.trim()
    ].join("\n");
  }

  const push = await runGitExec(["push"]);
  if (!push.ok) {
    return `git push failed:\n${push.stderr || push.stdout}`;
  }

  const head = await runTrustedCommand("git rev-parse --short HEAD");
  const state = await loadState();
  state.lastPushedHead = head.stdout.trim();
  await saveState(state);

  return [
    push.stdout.trim() || push.stderr.trim() || "push completed.",
    `head: ${head.stdout.trim()}`
  ].join("\n");
};
