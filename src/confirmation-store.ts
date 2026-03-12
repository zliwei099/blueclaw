type PendingAction = {
  action: "commit" | "push" | "restart" | "rollback";
  payload?: string;
  summary: string;
  createdAt: number;
};

const TTL_MS = 5 * 60 * 1000;
const pendingByConversation = new Map<string, PendingAction>();

export const setPendingConfirmation = (conversationId: string, pending: PendingAction): void => {
  pendingByConversation.set(conversationId, pending);
};

export const getPendingConfirmation = (conversationId: string): PendingAction | undefined => {
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
