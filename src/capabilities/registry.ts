import { FastifyBaseLogger } from "fastify";

import { executeDevelopmentTask } from "../dev-task.js";
import { loadCodexProfileSummary } from "../llm/providers/openai-codex-profile.js";
import { formatCodexRuntimeOverview } from "../llm/providers/openai-codex-runtime.js";
import { createCommit, getDiffSummary, pushCurrentBranch, restartWithBuildGate, rollbackToLastStable } from "../release-control.js";
import { inspectSystemTarget } from "../system-inspect.js";
import { listRecentTasks } from "../task-queue.js";
import { runCommand } from "../lib/command.js";
import { CapabilityId, CapabilityInvocation } from "./types.js";

export const CAPABILITY_RISK: Record<CapabilityId, "low" | "high"> = {
  "repo.diff": "low",
  "task.status": "low",
  "task.execute": "low",
  "repo.commit": "high",
  "repo.push": "high",
  "service.restart": "high",
  "service.rollback": "high",
  "system.inspect": "low",
  "provider.codex_profile": "low",
  "provider.codex_runtime": "low",
  "shell.exec": "low",
  "desktop.open_browser": "high"
};

export const formatTaskStatus = (): string =>
  listRecentTasks()
    .slice(0, 10)
    .map((task) =>
      [
        `${task.state} ${task.id} ${task.kind ?? "chat"}`,
        task.branch ? `branch=${task.branch}` : "",
        task.text.slice(0, 60),
        task.resultPreview ? `result=${task.resultPreview.replace(/\n/g, " ").slice(0, 80)}` : ""
      ]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n") || "no recent tasks";

const formatCodexProfile = (profile: {
  ok: boolean;
  authMode?: string;
  hasApiKey?: boolean;
  accountId?: string;
  email?: string;
  plan?: string;
  lastRefresh?: string;
  authPath: string;
  error?: string;
}): string =>
  profile.ok
    ? [
        `authMode: ${profile.authMode ?? "unknown"}`,
        `hasApiKey: ${profile.hasApiKey ? "yes" : "no"}`,
        `accountId: ${profile.accountId ?? "unknown"}`,
        `email: ${profile.email ?? "unknown"}`,
        `plan: ${profile.plan ?? "unknown"}`,
        `lastRefresh: ${profile.lastRefresh ?? "unknown"}`,
        `authPath: ${profile.authPath}`
      ].join("\n")
    : `failed to load codex profile: ${profile.error ?? "unknown error"}`;

export const executeCapability = async ({
  invocation,
  logger,
  taskId,
  onProgress
}: {
  invocation: CapabilityInvocation;
  logger: FastifyBaseLogger;
  taskId: string;
  onProgress?: (message: string) => Promise<void>;
}): Promise<string> => {
  switch (invocation.capability) {
    case "repo.diff":
      return getDiffSummary();
    case "task.status":
      return formatTaskStatus();
    case "task.execute":
      return executeDevelopmentTask({
        request: String(invocation.input?.request ?? ""),
        logger,
        taskId,
        onProgress
      });
    case "repo.commit":
      return createCommit({ message: String(invocation.input?.message ?? "chore: update via blueclaw") });
    case "repo.push":
      return pushCurrentBranch();
    case "service.restart":
      return restartWithBuildGate(logger);
    case "service.rollback":
      return rollbackToLastStable();
    case "system.inspect":
      return inspectSystemTarget(
        invocation.input?.target === "disk" || invocation.input?.target === "ports" ? invocation.input.target : "service"
      );
    case "provider.codex_profile":
      return formatCodexProfile(await loadCodexProfileSummary());
    case "provider.codex_runtime":
      return formatCodexRuntimeOverview();
    case "shell.exec": {
      const command = String(invocation.input?.command ?? "");
      const cwd = typeof invocation.input?.cwd === "string" ? invocation.input.cwd : undefined;
      const outcome = await runCommand(command, cwd);
      return outcome.ok ? JSON.stringify(outcome.result, null, 2) : `command rejected: ${outcome.reason}`;
    }
    case "desktop.open_browser":
      return [
        "desktop.open_browser is not enabled yet.",
        "This request is now recognized as a desktop capability, so it will no longer fall into development-task mode."
      ].join("\n");
  }
};
