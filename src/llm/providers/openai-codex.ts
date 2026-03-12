import { AssistantTurn, ChatMessage, ToolDefinition } from "../../types.js";

export const isOpenAiCodexConfigured = (): boolean => false;

export const generateOpenAiCodexTurn = async ({
  messages,
  tools
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}): Promise<AssistantTurn> => {
  void messages;
  void tools;

  throw new Error(
    "openai-codex provider is not implemented yet. Next step is wiring Codex/ChatGPT OAuth credentials and the corresponding backend protocol."
  );
};
