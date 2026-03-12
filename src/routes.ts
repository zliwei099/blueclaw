import { FastifyInstance } from "fastify";

import {
  getFeishuReplyContext,
  parseFeishuText,
  verifyFeishuToken
} from "./adapters/feishu.js";
import { markMessageSeen } from "./dedup.js";
import { loadCodexProfileSummary } from "./llm/providers/openai-codex-profile.js";
import {
  clearCodexRuntimeState,
  listCodexRuntimeStates,
  loadRecentCodexRuntimeEvents
} from "./llm/providers/openai-codex-runtime.js";
import { enqueueInboundTask, listRecentTasks } from "./task-queue.js";
import { FeishuEvent } from "./types.js";

export const registerRoutes = (app: FastifyInstance): void => {
  app.get("/healthz", async () => ({
    ok: true
  }));

  app.get("/tasks", async () => ({
    ok: true,
    tasks: listRecentTasks()
  }));

  app.get("/runtime/codex", async () => ({
    ok: true,
    runtime: {
      sessions: await listCodexRuntimeStates(),
      events: await loadRecentCodexRuntimeEvents()
    }
  }));

  app.get("/providers/codex/profile", async () => ({
    ok: true,
    profile: await loadCodexProfileSummary()
  }));

  app.post<{ Params: { sessionId: string } }>("/runtime/codex/:sessionId/reset", async (request) => ({
    ok: true,
    result: await clearCodexRuntimeState(request.params.sessionId)
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

    if (await markMessageSeen(context.messageId)) {
      request.log.info({ messageId: context.messageId }, "duplicate feishu webhook message skipped");
      return { ok: true, duplicate: true };
    }

    enqueueInboundTask(
      {
        id: context.messageId ?? crypto.randomUUID(),
        source: "feishu-webhook",
        messageId: context.messageId,
        chatId: context.chatId,
        userId: context.userId,
        text
      },
      app.log
    );

    return {
      ok: true,
      accepted: true
    };
  });
};
