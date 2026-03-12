import { runCodexExec } from "../../lib/codex.js";
import { AssistantTurn, ChatMessage, ToolDefinition } from "../../types.js";
import {
  loadCodexRuntimeState,
  saveCodexRuntimeState,
  summarizeCodexRuntimeState
} from "./openai-codex-runtime.js";

type CodexProtocolResponse = {
  type: "final" | "tool_calls";
  text?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }>;
};

const buildPrompt = ({
  messages,
  tools,
  runtimeSummary
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  runtimeSummary: string;
}): string => {
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
    .map(
      (tool) =>
        [
          `- ${tool.name}: ${tool.description}`,
          `  schema: ${JSON.stringify(tool.inputSchema)}`
        ].join("\n")
    )
    .join("\n");

  return [
    "You are being called as the LLM backend for blueclaw.",
    "You must act as a strict protocol adapter, not as a free-form chat model.",
    "Your job is to decide either:",
    '1. Return a final answer as JSON: {"type":"final","text":"..."}',
    '2. Return tool calls as JSON: {"type":"tool_calls","tool_calls":[{"id":"call-1","name":"tool.name","arguments":{...}}]}',
    "Important constraints:",
    "- Output JSON only. No markdown, no code fence, no prose before or after JSON.",
    "- If machine-specific or repository-specific facts are needed, prefer requesting blueclaw tools instead of using your own internal tooling.",
    "- Only use tool names from the provided list.",
    "- arguments must be a JSON object.",
    "- When tool results already answer the question, return type=final.",
    "- Keep final text concise and practical.",
    "",
    "Codex runtime session state:",
    runtimeSummary || "(empty runtime state)",
    "",
    "Available blueclaw tools:",
    toolSection,
    "",
    "Conversation history:",
    history
  ].join("\n");
};

export const isOpenAiCodexConfigured = (): boolean => true;

const extractJsonBlock = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("codex did not return a JSON payload");
};

const parseCodexProtocolResponse = (text: string): CodexProtocolResponse => {
  const payload = JSON.parse(extractJsonBlock(text)) as CodexProtocolResponse;
  if (payload.type !== "final" && payload.type !== "tool_calls") {
    throw new Error("codex returned an unsupported protocol type");
  }

  return payload;
};

export const generateOpenAiCodexTurn = async ({
  messages,
  tools,
  sessionId
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  sessionId?: string;
}): Promise<AssistantTurn> => {
  const effectiveSessionId = sessionId ?? "default";
  const runtimeState = await loadCodexRuntimeState(effectiveSessionId);
  const runtimeSummary = summarizeCodexRuntimeState(runtimeState);

  try {
    const result = await runCodexExec({
      prompt: buildPrompt({
        messages,
        tools,
        runtimeSummary
      })
    });

    const payload = parseCodexProtocolResponse(result.text);
    const latestUserInput = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";

    if (payload.type === "tool_calls") {
      const toolCalls = (payload.tool_calls ?? [])
        .filter((toolCall) => toolCall.name)
        .map((toolCall) => ({
          id: toolCall.id ?? crypto.randomUUID(),
          name: toolCall.name ?? "",
          argumentsText: JSON.stringify(toolCall.arguments ?? {})
        }));

      await saveCodexRuntimeState({
        ...runtimeState,
        sessionId: effectiveSessionId,
        turnCount: runtimeState.turnCount + 1,
        recentUserInputs: [...runtimeState.recentUserInputs, latestUserInput],
        recentToolNames: [...runtimeState.recentToolNames, ...toolCalls.map((toolCall) => toolCall.name)],
        lastResponseType: "tool_calls",
        lastResponsePreview: toolCalls.map((toolCall) => toolCall.name).join(", ").slice(0, 160)
      });

      return {
        text: payload.text ?? "",
        toolCalls
      };
    }

    await saveCodexRuntimeState({
      ...runtimeState,
      sessionId: effectiveSessionId,
      turnCount: runtimeState.turnCount + 1,
      recentUserInputs: [...runtimeState.recentUserInputs, latestUserInput],
      recentToolNames: runtimeState.recentToolNames,
      lastResponseType: "final",
      lastResponsePreview: (payload.text ?? "").slice(0, 160)
    });

    return {
      text: payload.text || "Codex 没有返回有效内容。",
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
