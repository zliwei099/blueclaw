import { runCodexExec } from "../../lib/codex.js";
import { AssistantTurn, ChatMessage, ToolDefinition } from "../../types.js";

const buildPrompt = (messages: ChatMessage[], tools: ToolDefinition[]): string => {
  const history = messages
    .map((message) => {
      if (message.role === "tool") {
        return `tool(${message.name}): ${message.content}`;
      }

      if (message.role === "assistant" && "toolCalls" in message) {
        return `assistant(tool_calls): ${JSON.stringify(message.toolCalls)}`;
      }

      return `${message.role}: ${message.content}`;
    })
    .join("\n\n");

  const toolSection = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return [
    "You are being called as the LLM backend for blueclaw.",
    "Use your normal Codex capabilities to answer the latest user request.",
    "Important constraints:",
    "- Stay within the current workspace.",
    "- Be concise and practical.",
    "- If tool usage is needed, you may use your own Codex tools and sandbox.",
    "",
    "Available blueclaw tool descriptions for context:",
    toolSection,
    "",
    "Conversation history:",
    history
  ].join("\n");
};

export const isOpenAiCodexConfigured = (): boolean => true;

export const generateOpenAiCodexTurn = async ({
  messages,
  tools
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}): Promise<AssistantTurn> => {
  try {
    const result = await runCodexExec({
      prompt: buildPrompt(messages, tools)
    });

    return {
      text: result.text || "Codex 没有返回有效内容。",
      toolCalls: []
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };

    throw new Error(
      [
        "openai-codex provider failed",
        failure.message,
        failure.stderr?.trim(),
        failure.stdout?.trim()
      ]
        .filter(Boolean)
        .join(": ")
    );
  }
};
