import { z } from "zod";

import { config } from "../config.js";
import { FeishuEvent } from "../types.js";

const feishuMessageContentSchema = z.object({
  text: z.string().optional()
});

export const verifyFeishuToken = (event: FeishuEvent): boolean => {
  if (!config.feishu.verificationToken) {
    return true;
  }

  const token = event.header?.token ?? event.token;
  return token === config.feishu.verificationToken;
};

export const parseFeishuText = (event: FeishuEvent): string => {
  const rawContent = event.event?.message?.content;
  if (!rawContent) {
    return "";
  }

  try {
    const parsed = feishuMessageContentSchema.parse(JSON.parse(rawContent));
    return parsed.text?.trim() ?? "";
  } catch {
    return "";
  }
};

export const getFeishuReplyContext = (event: FeishuEvent): {
  messageId?: string;
  chatId?: string;
  userId?: string;
} => ({
  messageId: event.event?.message?.message_id,
  chatId: event.event?.message?.chat_id,
  userId: event.event?.sender?.sender_id?.user_id
});
