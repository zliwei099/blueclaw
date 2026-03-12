import { FastifyBaseLogger } from "fastify";

import { runCommand } from "./lib/command.js";
import { runCodexExec } from "./lib/codex.js";

const buildDevPrompt = (request: string): string =>
  [
    "You are Codex working inside the blueclaw repository.",
    "Complete the requested development task directly in the working tree.",
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

export const executeDevelopmentTask = async ({
  request,
  logger,
  taskId
}: {
  request: string;
  logger: FastifyBaseLogger;
  taskId: string;
}): Promise<string> => {
  logger.info({ taskId, request }, "starting development task");

  const codexResult = await runCodexExec({
    prompt: buildDevPrompt(request),
    timeoutMs: 20 * 60 * 1000
  });

  const gitSummary = await summarizeGitStatus();

  return [
    `task: ${request}`,
    "",
    codexResult.text.trim(),
    "",
    "git status:",
    gitSummary
  ]
    .filter(Boolean)
    .join("\n");
};
