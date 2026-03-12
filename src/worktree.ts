import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { config } from "./config.js";

const execFileAsync = promisify(execFile);

const gitExec = async (
  args: string[],
  cwd = config.projectRoot
): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message
    };
  }
};

export const getProjectBranch = async (): Promise<string> => {
  const result = await gitExec(["branch", "--show-current"]);
  if (!result.ok) {
    return "unknown";
  }

  return result.stdout.trim() || "detached";
};

export const ensureCleanProjectWorktree = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const status = await gitExec(["status", "--short"]);
  if (!status.ok) {
    return { ok: false, reason: status.stderr || status.stdout || "git status failed" };
  }

  if (status.stdout.trim()) {
    return {
      ok: false,
      reason: ["project worktree is not clean.", status.stdout.trim()].join("\n")
    };
  }

  return { ok: true };
};

export const withIsolatedWorktree = async <T>({
  taskId,
  run
}: {
  taskId: string;
  run: (worktreePath: string) => Promise<T>;
}): Promise<T> => {
  const baseDir = join(config.sessionStoreDir, "worktrees");
  await mkdir(baseDir, { recursive: true });
  const tempDir = await mkdtemp(join(baseDir, `${taskId}-`));

  const addResult = await gitExec(["worktree", "add", "--detach", tempDir, "HEAD"]);
  if (!addResult.ok) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(addResult.stderr || addResult.stdout || "failed to create worktree");
  }

  try {
    return await run(tempDir);
  } finally {
    await gitExec(["worktree", "remove", "--force", tempDir]).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const collectWorktreePatch = async (worktreePath: string): Promise<{ patch: string; status: string }> => {
  const add = await gitExec(["add", "-A"], worktreePath);
  if (!add.ok) {
    throw new Error(add.stderr || add.stdout || "git add failed in worktree");
  }

  const diff = await gitExec(["diff", "--cached", "--binary", "HEAD"], worktreePath);
  if (!diff.ok) {
    throw new Error(diff.stderr || diff.stdout || "git diff failed in worktree");
  }

  const status = await gitExec(["status", "--short"], worktreePath);
  if (!status.ok) {
    throw new Error(status.stderr || status.stdout || "git status failed in worktree");
  }

  return {
    patch: diff.stdout,
    status: status.stdout.trim() || "working tree clean"
  };
};

export const applyPatchToProject = async ({
  patch,
  taskId
}: {
  patch: string;
  taskId: string;
}): Promise<void> => {
  if (!patch.trim()) {
    return;
  }

  const patchPath = join(tmpdir(), `blueclaw-${taskId}.patch`);
  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(patchPath, patch, "utf8");

  try {
    const apply = await gitExec(["apply", "--binary", patchPath]);
    if (!apply.ok) {
      throw new Error(apply.stderr || apply.stdout || "git apply failed");
    }
  } finally {
    await rm(patchPath, { force: true }).catch(() => undefined);
  }
};
