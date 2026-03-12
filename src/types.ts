export type CommandExecutionResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
};

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCallRequest[];
    }
  | {
      role: "tool";
      content: string;
      toolCallId: string;
      name: string;
    };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  argumentsText: string;
};

export type AssistantTurn = {
  text: string;
  toolCalls: ToolCallRequest[];
  progress?: string[];
  needsConfirmation?: {
    summary: string;
  };
  cancelled?: boolean;
};

export type FeishuEvent = {
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    create_time?: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        user_id?: string;
        open_id?: string;
        union_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
  challenge?: string;
  token?: string;
  type?: string;
};

export type InboundTask = {
  id: string;
  source: "feishu-webhook" | "feishu-ws";
  kind?: "chat" | "dev";
  messageId?: string;
  chatId?: string;
  userId?: string;
  text: string;
};

export type TaskState = "queued" | "running" | "completed" | "failed";

export type TaskRecord = InboundTask & {
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  error?: string;
  resultPreview?: string;
  branch?: string;
};

export type TaskProgressReporter = (message: string) => Promise<void>;
