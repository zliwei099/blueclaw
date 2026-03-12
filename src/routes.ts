import { FastifyInstance } from "fastify";

import {
  getFeishuReplyContext,
  parseFeishuText,
  verifyFeishuToken
} from "./adapters/feishu.js";
import { sendFeishuReply } from "./adapters/feishu-client.js";
import { processIncomingText } from "./message-router.js";
import { FeishuEvent } from "./types.js";

export const registerRoutes = (app: FastifyInstance): void => {
  app.get("/healthz", async () => ({
    ok: true
  }));

  app.post<{ Body: FeishuEvent }>("/webhooks/feishu/events", async (request, reply) => {
    const event = request.body;

    if (event.type === "url_verification" && event.challenge) {
      return { challenge: event.challenge };
    }

    if (!verifyFeishuToken(event)) {
      reply.code(401);
      return { ok: false, error: "invalid verification token" };
    }

    const text = parseFeishuText(event);
    const context = getFeishuReplyContext(event);

    app.log.info(
      {
        eventType: event.header?.event_type,
        messageId: context.messageId,
        chatId: context.chatId,
        userId: context.userId
      },
      "received feishu event"
    );

    const replyText = await processIncomingText(text);

    try {
      const sent = await sendFeishuReply({
        messageId: context.messageId,
        text: replyText
      });

      return {
        ok: true,
        reply: replyText,
        delivery: sent
      };
    } catch (error) {
      request.log.error({ error }, "failed to send feishu reply");
      reply.code(502);
      return {
        ok: false,
        reply: replyText,
        error: error instanceof Error ? error.message : "unknown feishu send error"
      };
    }
  });
};
