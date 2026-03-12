import { config } from "../config.js";

type FeishuTokenResponse = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

type FeishuMessageResponse = {
  code: number;
  msg: string;
};

type FeishuReactionResponse = {
  code: number;
  msg: string;
  data?: {
    reaction_id?: string;
  };
};

let cachedToken:
  | {
      value: string;
      expiresAt: number;
    }
  | undefined;

const hasCredentials = (): boolean =>
  Boolean(config.feishu.appId && config.feishu.appSecret);

const getTenantAccessToken = async (): Promise<string | null> => {
  if (!hasCredentials()) {
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const response = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret
      })
    }
  );

  const payload = (await response.json()) as FeishuTokenResponse;
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`failed to fetch tenant access token: ${payload.msg}`);
  }

  cachedToken = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + (payload.expire ?? 7_200) * 1000
  };

  return cachedToken.value;
};

export const sendFeishuReply = async ({
  messageId,
  text
}: {
  messageId?: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> => {
  if (!messageId) {
    return { sent: false, reason: "message id is missing" };
  }

  const tenantAccessToken = await getTenantAccessToken();
  if (!tenantAccessToken) {
    return { sent: false, reason: "feishu credentials are not configured" };
  }

  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({
        text
      })
    })
  });

  const payload = (await response.json()) as FeishuMessageResponse;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`failed to send feishu reply: ${payload.msg}`);
  }

  return { sent: true };
};

export const addFeishuReaction = async ({
  messageId,
  emojiType
}: {
  messageId?: string;
  emojiType: string;
}): Promise<{ sent: boolean; reactionId?: string; reason?: string }> => {
  if (!messageId) {
    return { sent: false, reason: "message id is missing" };
  }

  const tenantAccessToken = await getTenantAccessToken();
  if (!tenantAccessToken) {
    return { sent: false, reason: "feishu credentials are not configured" };
  }

  const response = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reactions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${tenantAccessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reaction_type: {
          emoji_type: emojiType
        }
      })
    }
  );

  const payload = (await response.json()) as FeishuReactionResponse;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`failed to add feishu reaction: ${payload.msg}`);
  }

  return { sent: true, reactionId: payload.data?.reaction_id };
};

export const removeFeishuReaction = async ({
  messageId,
  reactionId
}: {
  messageId?: string;
  reactionId?: string;
}): Promise<{ sent: boolean; reason?: string }> => {
  if (!messageId) {
    return { sent: false, reason: "message id is missing" };
  }

  if (!reactionId) {
    return { sent: false, reason: "reaction id is missing" };
  }

  const tenantAccessToken = await getTenantAccessToken();
  if (!tenantAccessToken) {
    return { sent: false, reason: "feishu credentials are not configured" };
  }

  const response = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${tenantAccessToken}`
      }
    }
  );

  const payload = (await response.json()) as FeishuReactionResponse;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`failed to remove feishu reaction: ${payload.msg}`);
  }

  return { sent: true };
};
