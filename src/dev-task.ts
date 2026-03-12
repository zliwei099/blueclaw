import { FastifyBaseLogger } from "fastify";

import { runCommand } from "./lib/command.js";
import { runCodexExec } from "./lib/codex.js";
import { TaskProgressReporter } from "./types.js";
import {
  applyPatchToProject,
  collectWorktreePatch,
  ensureCleanProjectWorktree,
  getProjectBranch,
  withIsolatedWorktree
} from "./worktree.js";

const buildDevPrompt = (request: string): string =>
  [
    "You are Codex working inside the blueclaw repository.",
    "Complete the requested development task inside the provided isolated git worktree.",
    "Rules:",
    "- Make the smallest coherent set of changes.",
    "- Run relevant local verification such as npm run build or npm run check when appropriate.",
    "- Do not create git commits.",
    "- End with a concise summary of: changed files, verification run, remaining risks.",
    "",
    `Task: ${request}`
  ].join("\n");

const summarizeGitStatus = async (): Promise<string> => {
  const status = await runCommand("git status --short");
  if (!status.ok) {
    return `git status unavailable: ${status.reason}`;
  }

  return status.result.stdout.trim() || "working tree clean";
};

export const getCurrentBranch = async (): Promise<string> => {
  return getProjectBranch();
};

export const executeDevelopmentTask = async ({
  request,
  logger,
  taskId,
  onProgress
}: {
  request: string;
  logger: FastifyBaseLogger;
  taskId: string;
  onProgress?: TaskProgressReporter;
}): Promise<string> => {
  logger.info({ taskId, request }, "starting development task");

  const clean = await ensureCleanProjectWorktree();
  if (!clean.ok) {
    return [`task: ${request}`, "development task blocked before execution.", clean.reason].join("\n\n");
  }

  const branch = await getCurrentBranch();
  await onProgress?.("已创建开发任务，正在准备隔离 worktree。");

  const isolated = await withIsolatedWorktree({
    taskId,
    run: async (worktreePath) => {
      await onProgress?.("隔离 worktree 已就绪，正在调用 Codex 修改代码。");
      const codexResult = await runCodexExec({
        prompt: buildDevPrompt(request),
        cwd: worktreePath,
        timeoutMs: 20 * 60 * 1000
      });

      await onProgress?.("Codex 已完成修改，正在收集补丁。");
      const patch = await collectWorktreePatch(worktreePath);

      if (patch.patch.trim()) {
        await onProgress?.("正在把隔离 worktree 的改动同步回主工作树。");
        await applyPatchToProject({
          patch: patch.patch,
          taskId
        });
      }

      return {
        codexResult,
        patchStatus: patch.status
      };
    }
  });

  const gitSummary = await summarizeGitStatus();
  await onProgress?.("开发任务已完成，正在整理结果。");

  return [
    `task: ${request}`,
    `projectRoot: ${process.cwd()}`,
    `branch: ${branch}`,
    "worktree: isolated and merged back",
    "",
    isolated.codexResult.text.trim(),
    "",
    "isolated worktree status:",
    isolated.patchStatus,
    "",
    "git status:",
    gitSummary
  ]
    .filter(Boolean)
    .join("\n");
};
