export type CommandExecutionResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
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
