import { FastifyBaseLogger } from "fastify";

import { sendFeishuReply } from "./adapters/feishu-client.js";
import { processIncomingText } from "./message-router.js";
import { InboundTask } from "./types.js";

type TaskState = "queued" | "running" | "completed" | "failed";

type QueuedTask = InboundTask & {
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

const pendingTasks: QueuedTask[] = [];
const recentTasks = new Map<string, QueuedTask>();
const MAX_RECENT_TASKS = 200;
let workerStarted = false;
let workerRunning = false;

const rememberTask = (task: QueuedTask): void => {
  recentTasks.set(task.id, { ...task });

  if (recentTasks.size <= MAX_RECENT_TASKS) {
    return;
  }

  const oldest = [...recentTasks.keys()][0];
  if (oldest) {
    recentTasks.delete(oldest);
  }
};

const nowIso = (): string => new Date().toISOString();

const runWorker = async (logger: FastifyBaseLogger): Promise<void> => {
  if (workerRunning) {
    return;
  }

  workerRunning = true;

  try {
    while (pendingTasks.length > 0) {
      const task = pendingTasks.shift();
      if (!task) {
        continue;
      }

      task.state = "running";
      task.updatedAt = nowIso();
      rememberTask(task);

      try {
        const replyText = await processIncomingText({
          text: task.text,
          logger,
          context: {
            source: task.source,
            messageId: task.messageId,
            chatId: task.chatId,
            userId: task.userId
          }
        });

        const delivery = await sendFeishuReply({
          messageId: task.messageId,
          text: replyText
        });

        if (!delivery.sent) {
          logger.warn({ taskId: task.id, delivery }, "task reply skipped");
        }

        task.state = "completed";
        task.updatedAt = nowIso();
        rememberTask(task);
      } catch (error) {
        task.state = "failed";
        task.updatedAt = nowIso();
        task.error = error instanceof Error ? error.message : "unknown task error";
        rememberTask(task);

        logger.error(
          {
            taskId: task.id,
            error: task.error,
            source: task.source,
            messageId: task.messageId
          },
          "task execution failed"
        );
      }
    }
  } finally {
    workerRunning = false;
  }
};

export const enqueueInboundTask = (task: InboundTask, logger: FastifyBaseLogger): void => {
  const queuedTask: QueuedTask = {
    ...task,
    state: "queued",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  pendingTasks.push(queuedTask);
  rememberTask(queuedTask);

  logger.info(
    {
      taskId: queuedTask.id,
      source: queuedTask.source,
      messageId: queuedTask.messageId,
      queueSize: pendingTasks.length
    },
    "task enqueued"
  );

  void runWorker(logger);
};

export const ensureTaskQueueStarted = (logger: FastifyBaseLogger): void => {
  if (workerStarted) {
    return;
  }

  workerStarted = true;
  logger.info("task queue ready");
};

export const listRecentTasks = (): QueuedTask[] =>
  [...recentTasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
