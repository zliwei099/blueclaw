export type ConfirmableActionType = "commit" | "push" | "restart" | "rollback";

export type PendingWorkflowStep =
  | {
      type: "task";
      request: string;
      summary: string;
    }
  | {
      type: "action";
      action: ConfirmableActionType;
      payload?: string;
      summary: string;
    };

export type PendingConfirmation =
  | {
      kind: "action";
      action: ConfirmableActionType;
      payload?: string;
      summary: string;
      createdAt: number;
    }
  | {
      kind: "workflow";
      summary: string;
      steps: PendingWorkflowStep[];
      createdAt: number;
    };

const TTL_MS = 5 * 60 * 1000;
const pendingByConversation = new Map<string, PendingConfirmation>();

export const setPendingConfirmation = (conversationId: string, pending: PendingConfirmation): void => {
  pendingByConversation.set(conversationId, pending);
};

export const getPendingConfirmation = (conversationId: string): PendingConfirmation | undefined => {
  const value = pendingByConversation.get(conversationId);
  if (!value) {
    return undefined;
  }

  if (value.createdAt + TTL_MS < Date.now()) {
    pendingByConversation.delete(conversationId);
    return undefined;
  }

  return value;
};

export const clearPendingConfirmation = (conversationId: string): void => {
  pendingByConversation.delete(conversationId);
};

export const isConfirmationText = (text: string): boolean =>
  ["确认", "确认执行", "继续", "yes", "confirm"].includes(text.trim().toLowerCase());
