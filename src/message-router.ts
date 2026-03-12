import { FastifyBaseLogger } from "fastify";

import { executeDevelopmentTask } from "./dev-task.js";
import { handleAgentMessage, formatCommandReply } from "./agent/runtime.js";
import { logIncomingMessage, logOutgoingMessage, logToolCall, MessageAuditContext } from "./audit.js";
import { runCommand } from "./lib/command.js";
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

  if (text === "/status" || text === "/tasks") {
    const replyText = listRecentTasks()
      .slice(0, 10)
      .map((task) => `${task.state} ${task.id} ${task.kind ?? "chat"} ${task.text.slice(0, 60)}`)
      .join("\n") || "no recent tasks";
    logOutgoingMessage(logger, context, replyText);
    return replyText;
  }

  if (text.startsWith("/task ")) {
    const request = text.slice(6).trim();
    const replyText = await executeDevelopmentTask({
      request,
      logger,
      taskId: context.messageId ?? crypto.randomUUID()
    });
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

  const replyText = await handleAgentMessage({
    input: text,
    sessionId: context.chatId ?? context.userId ?? "default",
    logger
  });
  logOutgoingMessage(logger, context, replyText);
  return replyText;
};
