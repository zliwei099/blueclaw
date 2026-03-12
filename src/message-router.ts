import { FastifyBaseLogger } from "fastify";

import {
  clearPendingConfirmation,
  ConfirmableActionType,
  getPendingConfirmation,
  hasPendingConfirmation,
  isCancelText,
  isConfirmationText,
  PendingWorkflowStep,
  setPendingConfirmation
} from "./confirmation-store.js";
import { executeDevelopmentTask } from "./dev-task.js";
import { routeNaturalIntent } from "./intent-router.js";
import { handleAgentMessage, formatCommandReply } from "./agent/runtime.js";
import { logIncomingMessage, logOutgoingMessage, logToolCall, MessageAuditContext } from "./audit.js";
import { runCommand } from "./lib/command.js";
import {
  createCommit,
  getDiffSummary,
  pushCurrentBranch,
  restartWithBuildGate,
  rollbackToLastStable
} from "./release-control.js";
import { inspectSystemTarget } from "./system-inspect.js";
import { listRecentTasks } from "./task-queue.js";

export const processIncomingText = async ({
  text,
  logger,
  context,
  onProgress
}: {
  text: string;
  logger: FastifyBaseLogger;
  context: MessageAuditContext;
  onProgress?: (message: string) => Promise<void>;
}): Promise<string> => {
  logIncomingMessage(logger, context, text);

  if (!text) {
    const replyText = "empty or unsupported message";
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  const conversationId = context.chatId ?? context.userId ?? "default";

  if (isCancelText(text)) {
    if (hasPendingConfirmation(conversationId)) {
      clearPendingConfirmation(conversationId);
      const replyText = "已取消当前等待确认的动作。";
      logOutgoingMessage(logger, context, replyText);
      return replyText;
    }

    const replyText = "当前没有待取消的确认动作。";
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (isConfirmationText(text)) {
    const pending = getPendingConfirmation(conversationId);
    if (pending) {
      clearPendingConfirmation(conversationId);

      let replyText = "";
      if (pending.kind === "workflow") {
        replyText = await executeConfirmedWorkflow({
          steps: pending.steps,
          logger,
          taskId: context.messageId ?? crypto.randomUUID(),
          onProgress
        });
      } else {
        if (pending.kind === "agent") {
          replyText = "已收到确认。当前这类 agent 级确认只做提示，不会自动继续危险动作。";
        } else {
          replyText = await executeConfirmableAction({
            action: pending.action,
            payload: pending.payload,
            logger
          });
        }
      }

      logOutgoingMessage(logger, context, replyText);
      return replyText;
    }
  }

  if (text === "/diff") {
    const replyText = naturalizeResult("这是当前代码库的改动情况。", await getDiffSummary());
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text.startsWith("/commit ")) {
    const message = text.slice(8).trim();
    const replyText = naturalizeResult("提交已经处理完了。", await createCommit({ message }));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text === "/push") {
    const replyText = naturalizeResult("推送动作已经处理完了。", await pushCurrentBranch());
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text === "/rollback") {
    const replyText = naturalizeResult("回滚动作已经处理完了。", await rollbackToLastStable());
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text === "/restart" || text === "重启服务" || text === "重启下服务") {
    const replyText = naturalizeResult("重启动作已经处理完了。", await restartWithBuildGate(logger));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text === "/status" || text === "/tasks") {
    const replyText = listRecentTasks()
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
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text.startsWith("/task ")) {
    const request = text.slice(6).trim();
    const replyText = naturalizeResult("开发任务已经执行完成。", await executeDevelopmentTask({
      request,
      logger,
      taskId: context.messageId ?? crypto.randomUUID(),
      onProgress
    }));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text.startsWith("/run ")) {
    const command = text.slice(5).trim();
    const outcome = await runCommand(command);
    if (!outcome.ok) {
      logToolCall(logger, context, {
        command,
        ok: false,
        reason: outcome.reason
      });

      const replyText = `command rejected: ${outcome.reason}`;
      logOutgoingMessage(logger, context, replyText);
      return replyText;
    }

    logToolCall(logger, context, {
      command,
      cwd: outcome.cwd,
      ok: outcome.result.ok,
      exitCode: outcome.result.exitCode,
      durationMs: outcome.result.durationMs
    });

    const replyText = formatCommandReply(command, outcome.cwd, outcome.result);
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  const routed = routeNaturalIntent(text);
  if (routed.type === "builtin") {
    return processIncomingText({
      text: routed.command,
      logger,
      context,
      onProgress
    });
  }

  if (routed.type === "inspect") {
    const replyText = naturalizeResult("这是当前系统巡检结果。", await inspectSystemTarget(routed.target));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (routed.type === "task") {
    const replyText = naturalizeResult("我已经按开发任务处理这条请求。", await executeDevelopmentTask({
      request: routed.request,
      logger,
      taskId: context.messageId ?? crypto.randomUUID(),
      onProgress
    }));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (routed.type === "confirmable") {
    setPendingConfirmation(conversationId, {
      kind: "action",
      action: routed.action,
      payload: routed.payload,
      summary: routed.summary,
      createdAt: Date.now()
    });

    const replyText = [
      `我理解你要执行的是：${routed.summary}。`,
      "这是高风险动作。若继续，请直接回复“确认”。"
    ].join("\n");
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (routed.type === "workflow") {
    setPendingConfirmation(conversationId, {
      kind: "workflow",
      summary: routed.summary,
      steps: routed.steps,
      createdAt: Date.now()
    });

    const replyText = [
      "我把这条请求拆成了一个执行计划：",
      routed.summary,
      "",
      "这包含代码修改或高风险动作。若继续，请直接回复“确认”。"
    ].join("\n");
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  const replyText = await handleAgentMessage({
    input: text,
    sessionId: conversationId,
    logger,
    onProgress,
    onNeedConfirmation: async (summary) => {
      setPendingConfirmation(conversationId, {
        kind: "agent",
        summary,
        createdAt: Date.now()
      });
    }
  });
  logOutgoingMessage(logger, context, replyText);
  return replyText;
};

const naturalizeResult = (lead: string, detail: string): string =>
  [lead, "", detail].filter(Boolean).join("\n");

const executeConfirmableAction = async ({
  action,
  payload,
  logger
}: {
  action: ConfirmableActionType;
  payload?: string;
  logger: FastifyBaseLogger;
}): Promise<string> => {
  switch (action) {
    case "commit":
      return createCommit({ message: payload ?? "chore: update via blueclaw" });
    case "push":
      return pushCurrentBranch();
    case "restart":
      return restartWithBuildGate(logger);
    case "rollback":
      return rollbackToLastStable();
  }
};

const executeConfirmedWorkflow = async ({
  steps,
  logger,
  taskId,
  onProgress
}: {
  steps: PendingWorkflowStep[];
  logger: FastifyBaseLogger;
  taskId: string;
  onProgress?: (message: string) => Promise<void>;
}): Promise<string> => {
  const results: string[] = [];

  for (const [index, step] of steps.entries()) {
    await onProgress?.(`执行计划步骤 ${index + 1}/${steps.length}: ${step.summary}`);

    if (step.type === "task") {
      const result = await executeDevelopmentTask({
        request: step.request,
        logger,
        taskId: `${taskId}-${index + 1}`,
        onProgress
      });
      results.push([`步骤 ${index + 1}: ${step.summary}`, result].join("\n"));
      continue;
    }

    const result = await executeConfirmableAction({
      action: step.action,
      payload: step.payload,
      logger
    });
    results.push([`步骤 ${index + 1}: ${step.summary}`, result].join("\n"));
  }

  return ["执行计划已完成。", "", ...results].join("\n\n");
};
