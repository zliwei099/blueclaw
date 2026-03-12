import { FastifyBaseLogger } from "fastify";

export type MessageAuditContext = {
  source: "feishu-webhook" | "feishu-ws";
  userId?: string;
  chatId?: string;
  messageId?: string;
};

export const logIncomingMessage = (
  logger: FastifyBaseLogger,
  context: MessageAuditContext,
  text: string
): void => {
  logger.info(
    {
      ...context,
      textPreview: text.slice(0, 200)
    },
    "incoming message"
  );
};

export const logOutgoingMessage = (
  logger: FastifyBaseLogger,
  context: MessageAuditContext,
  replyText: string
): void => {
  logger.info(
    {
      ...context,
      replyPreview: replyText.slice(0, 200)
    },
    "outgoing message"
  );
};

export const logToolCall = (
  logger: FastifyBaseLogger,
  context: MessageAuditContext,
  payload: {
    command: string;
    cwd?: string;
    ok: boolean;
    reason?: string;
    exitCode?: number | null;
    durationMs?: number;
  }
): void => {
  logger.info(
    {
      ...context,
      tool: "shell.exec",
      ...payload
    },
    "tool call"
  );
};
