import * as Lark from "@larksuiteoapi/node-sdk";
import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { markMessageSeen } from "../dedup.js";
import { enqueueInboundTask } from "../task-queue.js";

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
      if (await markMessageSeen(data.message.message_id)) {
        logger.info(
          {
            source: "feishu-ws",
            messageId: data.message.message_id
          },
          "duplicate feishu websocket message skipped"
        );
        return { sent: false, reason: "duplicate message skipped" };
      }

      enqueueInboundTask(
        {
          id: data.message.message_id ?? crypto.randomUUID(),
          source: "feishu-ws",
          messageId: data.message.message_id,
          chatId: data.message.chat_id,
          userId: data.sender?.sender_id?.user_id,
          text: parseMessageText(data.message.content)
        },
        logger
      );

      return { accepted: true };
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
