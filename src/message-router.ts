import { FastifyBaseLogger } from "fastify";

import { clearPendingConfirmation, getPendingConfirmation, isConfirmationText, setPendingConfirmation } from "./confirmation-store.js";
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
import { listRecentTasks } from "./task-queue.js";

export const processIncomingText = async ({
  text,
  logger,
  context
}: {
  text: string;
  logger: FastifyBaseLogger;
  context: MessageAuditContext;
}): Promise<string> => {
  logIncomingMessage(logger, context, text);

  if (!text) {
    const replyText = "empty or unsupported message";
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  const conversationId = context.chatId ?? context.userId ?? "default";

  if (isConfirmationText(text)) {
    const pending = getPendingConfirmation(conversationId);
    if (pending) {
      clearPendingConfirmation(conversationId);

      let replyText = "";
      switch (pending.action) {
        case "commit":
          replyText = await createCommit({ message: pending.payload ?? "chore: update via blueclaw" });
          break;
        case "push":
          replyText = await pushCurrentBranch();
          break;
        case "restart":
          replyText = await restartWithBuildGate(logger);
          break;
        case "rollback":
          replyText = await rollbackToLastStable();
          break;
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
      taskId: context.messageId ?? crypto.randomUUID()
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
      context
    });
  }

  if (routed.type === "task") {
    const replyText = naturalizeResult("我已经按开发任务处理这条请求。", await executeDevelopmentTask({
      request: routed.request,
      logger,
      taskId: context.messageId ?? crypto.randomUUID()
    }));
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (routed.type === "confirmable") {
    setPendingConfirmation(conversationId, {
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

  const replyText = await handleAgentMessage({
    input: text,
    sessionId: conversationId,
    logger
  });
  logOutgoingMessage(logger, context, replyText);
  return replyText;
};

const naturalizeResult = (lead: string, detail: string): string =>
  [lead, "", detail].filter(Boolean).join("\n");
