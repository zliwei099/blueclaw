import * as Lark from "@larksuiteoapi/node-sdk";
import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { sendFeishuReply } from "./feishu-client.js";
import { processIncomingText } from "../message-router.js";

type FeishuMessageReceiveEvent = {
  sender?: {
    sender_id?: {
      user_id?: string;
      open_id?: string;
      union_id?: string;
    };
  };
  message: {
    message_id?: string;
    chat_id?: string;
    content?: string;
    message_type?: string;
  };
};

const parseMessageText = (content?: string): string => {
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? "";
  } catch {
    return "";
  }
};

export const startFeishuWsClient = (logger: FastifyBaseLogger): { started: boolean } => {
  if (config.feishu.eventMode === "webhook") {
    logger.info("feishu websocket disabled by config");
    return { started: false };
  }

  if (!config.feishu.appId || !config.feishu.appSecret) {
    logger.warn("feishu websocket not started because app credentials are missing");
    return { started: false };
  }

  const dispatcher = new Lark.EventDispatcher(
    config.feishu.encryptKey
      ? {
          encryptKey: config.feishu.encryptKey
        }
      : {}
  ).register({
    "im.message.receive_v1": async (data: FeishuMessageReceiveEvent) => {
      const text = parseMessageText(data.message.content);
      const replyText = await processIncomingText({
        text,
        logger,
        context: {
          source: "feishu-ws",
          messageId: data.message.message_id,
          chatId: data.message.chat_id,
          userId: data.sender?.sender_id?.user_id
        }
      });

      const delivery = await sendFeishuReply({
        messageId: data.message.message_id,
        text: replyText
      });

      if (!delivery.sent) {
        logger.warn({ delivery, source: "feishu-ws" }, "feishu websocket reply skipped");
      }

      return delivery;
    }
  });

  const wsClient = new Lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    loggerLevel: Lark.LoggerLevel.info
  });

  wsClient.start({
    eventDispatcher: dispatcher
  });

  logger.info(
    {
      mode: config.feishu.eventMode
    },
    "feishu websocket client started"
  );

  return { started: true };
};
