import { config } from "../../config.js";
import { AssistantTurn, ChatMessage, ToolDefinition } from "../../types.js";

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

export const isOpenAiCompatibleConfigured = (): boolean =>
  Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model);

export const generateOpenAiCompatibleTurn = async ({
  messages,
  tools
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}): Promise<AssistantTurn> => {
  if (!isOpenAiCompatibleConfigured()) {
    throw new Error("openai-compatible llm is not configured");
  }

  const response = await fetch(`${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.llm.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.1,
      messages: messages.map((message) => {
        if (message.role === "assistant" && "toolCalls" in message) {
          return {
            role: "assistant",
            content: message.content,
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: toolCall.argumentsText
              }
            }))
          };
        }

        if (message.role === "tool") {
          return {
            role: "tool",
            content: message.content,
            tool_call_id: message.toolCallId,
            name: message.name
          };
        }

        return {
          role: message.role,
          content: message.content
        };
      }),
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      })),
      tool_choice: "auto"
    })
  });

  const payload = (await response.json()) as OpenAIChatCompletionResponse;
  if (!response.ok) {
    throw new Error(`llm request failed with status ${response.status}`);
  }

  const message = payload.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? [])
    .filter((toolCall) => toolCall.type === "function" && toolCall.function?.name)
    .map((toolCall) => ({
      id: toolCall.id ?? crypto.randomUUID(),
      name: toolCall.function?.name ?? "",
      argumentsText: toolCall.function?.arguments ?? "{}"
    }));

  return {
    text: message?.content ?? "",
    toolCalls
  };
};
