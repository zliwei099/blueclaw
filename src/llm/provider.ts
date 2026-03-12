import { config } from "../config.js";
import { AssistantTurn, ChatMessage, ToolDefinition } from "../types.js";
import {
  generateOpenAiCompatibleTurn,
  isOpenAiCompatibleConfigured
} from "./providers/openai-compatible.js";
import {
  generateOpenAiCodexTurn,
  isOpenAiCodexConfigured
} from "./providers/openai-codex.js";

type ProviderName = "openai-compatible" | "openai-codex";

export const isLlmConfigured = (): boolean => {
  switch (config.llm.provider as ProviderName) {
    case "openai-codex":
      return isOpenAiCodexConfigured();
    case "openai-compatible":
    default:
      return isOpenAiCompatibleConfigured();
  }
};

export const generateAssistantTurn = async ({
  messages,
  tools,
  sessionId
}: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  sessionId?: string;
}): Promise<AssistantTurn> => {
  switch (config.llm.provider as ProviderName) {
    case "openai-codex":
      return generateOpenAiCodexTurn({ messages, tools, sessionId });
    case "openai-compatible":
    default:
      return generateOpenAiCompatibleTurn({ messages, tools });
  }
};

export const getLlmUnavailableReason = (): string => {
  switch (config.llm.provider as ProviderName) {
    case "openai-codex":
      return "当前 provider=openai-codex，但本机 Codex CLI 无法使用。请先确认本机 Codex 已登录且命令可执行。";
    case "openai-compatible":
    default:
      return "LLM 还没有配置完成。可先直接发送 `/run <command>`，或配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 后使用自然语言 Agent。";
  }
};
