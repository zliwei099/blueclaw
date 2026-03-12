import { FastifyBaseLogger } from "fastify";

import {
  clearPendingConfirmation,
  getPendingConfirmation,
  hasPendingConfirmation,
  isCancelText,
  isConfirmationText,
  setPendingConfirmation
} from "./confirmation-store.js";
import { handleAgentMessage, formatCommandReply } from "./agent/runtime.js";
import { logIncomingMessage, logOutgoingMessage, logToolCall, MessageAuditContext } from "./audit.js";
import { executeCapabilityPlan } from "./core/executor.js";
import { planTextRequest } from "./core/planner.js";
import { runCommand } from "./lib/command.js";

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
      if (pending.kind === "agent") {
        replyText = "已收到确认。当前这类 agent 级确认只做提示，不会自动继续危险动作。";
      } else {
        replyText = await executeCapabilityPlan({
          steps:
            pending.kind === "workflow"
              ? pending.steps.map((step) =>
                  step.type === "task"
                    ? { capability: "task.execute" as const, input: { request: step.request }, summary: step.summary }
                    : {
                        capability:
                          step.action === "commit"
                            ? "repo.commit"
                            : step.action === "push"
                              ? "repo.push"
                              : step.action === "restart"
                                ? "service.restart"
                                : "service.rollback",
                        input: step.payload ? { message: step.payload } : undefined,
                        summary: step.summary
                      }
                )
              : [
                  {
                    capability:
                      pending.action === "commit"
                        ? "repo.commit"
                        : pending.action === "push"
                          ? "repo.push"
                          : pending.action === "restart"
                            ? "service.restart"
                            : "service.rollback",
                    input: pending.payload ? { message: pending.payload } : undefined,
                    summary: pending.summary
                  }
                ],
          logger,
          taskId: context.messageId ?? crypto.randomUUID(),
          onProgress
        });
      }

      logOutgoingMessage(logger, context, replyText);
      return replyText;
    }
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

  const plan = planTextRequest(text);
  if (plan.kind === "execute") {
    const replyText = await executeCapabilityPlan({
      steps: plan.steps,
      logger,
      taskId: context.messageId ?? crypto.randomUUID(),
      onProgress
    });
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (plan.kind === "confirm") {
    const replyText = [
      "我把这条请求解析成了一个能力计划：",
      plan.summary,
      "",
      "这包含高风险动作。若继续，请直接回复“确认”。"
    ].join("\n");

    setPendingConfirmation(conversationId, {
      kind: "workflow",
      summary: plan.summary,
      steps: plan.steps.map((step) =>
        step.capability === "task.execute"
          ? { type: "task" as const, request: String(step.input?.request ?? ""), summary: step.summary }
          : {
              type: "action" as const,
              action:
                step.capability === "repo.commit"
                  ? "commit"
                  : step.capability === "repo.push"
                    ? "push"
                    : step.capability === "service.restart"
                      ? "restart"
                      : "rollback",
              payload: typeof step.input?.message === "string" ? step.input.message : undefined,
              summary: step.summary
            }
      ),
      createdAt: Date.now()
    });

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
