import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { getLlmUnavailableReason, generateAssistantTurn, isLlmConfigured } from "../llm/provider.js";
import { formatSkillCatalog, loadSkillCatalog } from "../skills/catalog.js";
import { formatAgentMemory, loadAgentMemory, rememberAgentItems } from "../storage/agent-memory.js";
import {
  extractSessionMemory,
  formatSessionMemory,
  loadSessionState,
  mergeSessionMemory,
  saveSessionState
} from "../storage/session-store.js";
import { executeTool, toolDefinitions } from "../tools/registry.js";
import { ChatMessage } from "../types.js";

const NATURAL_LANGUAGE_HINTS = [
  { pattern: /当前目录|pwd|在哪里/i, command: "pwd" },
  { pattern: /哪些文件|列出文件|ls\b/i, command: "ls" },
  { pattern: /git 状态|git status/i, command: "git status --short --branch" }
];

const SYSTEM_PROMPT = [
  "You are blueclaw, a general-purpose coding and automation agent running inside a controlled workspace on a real computer.",
  "You can use built-in tools for repository actions, system inspection, persistent memory, and installed skills.",
  "Prefer tools for any machine-specific or repository-specific fact.",
  "Use persistent memory to remember durable operator preferences and environment facts.",
  "Use installed skills when they fit the task better than ad-hoc reasoning.",
  "Do not claim unrestricted power: stay within tool and policy boundaries, and explain blocked actions clearly.",
  "Be concise, practical, and execution-oriented."
].join(" ");

export const handleAgentMessage = async ({
  input,
  sessionId,
  logger,
  onProgress
}: {
  input: string;
  sessionId: string;
  logger: FastifyBaseLogger;
  onProgress?: (message: string) => Promise<void>;
}): Promise<string> => {
  if (!isLlmConfigured()) {
    return handleHintFallback(input);
  }

  const { messages: sessionMessages, memory: sessionMemory } = await loadSessionState(sessionId);
  const nextMemory = mergeSessionMemory(sessionMemory, extractSessionMemory(input));
  const memoryPrompt = formatSessionMemory(nextMemory);
  const agentMemory = await loadAgentMemory();
  const agentMemoryPrompt = formatAgentMemory(agentMemory);
  const skills = await loadSkillCatalog();
  const skillsPrompt = formatSkillCatalog(skills);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(agentMemoryPrompt
      ? [
          {
            role: "system" as const,
            content: `Persistent agent memory:\n${agentMemoryPrompt}\nPrefer updating it when the user states durable rules or preferences.`
          }
        ]
      : []),
    ...(skillsPrompt
      ? [
          {
            role: "system" as const,
            content: `Installed skills:\n${skillsPrompt}\nIf a task matches one of these, inspect it with skill.read before acting.`
          }
        ]
      : []),
    ...(memoryPrompt
      ? [
          {
            role: "system" as const,
            content: `Known conversation memory:\n${memoryPrompt}\nUse it only when it helps with the current request.`
          }
        ]
      : []),
    ...sessionMessages,
    { role: "user", content: input }
  ];

  try {
    for (let step = 0; step < config.llm.maxSteps; step += 1) {
      const turn = await generateAssistantTurn({
        messages,
        tools: toolDefinitions,
        sessionId
      });

      for (const progressMessage of turn.progress ?? []) {
        await onProgress?.(progressMessage);
      }

      if (turn.toolCalls.length === 0) {
        if (turn.needsConfirmation) {
          const reply = [turn.text || "执行前需要确认。", `确认事项：${turn.needsConfirmation.summary}`]
            .filter(Boolean)
            .join("\n");
          await saveSessionState(sessionId, {
            messages: [...sessionMessages, { role: "user", content: input }, { role: "assistant", content: reply }],
            memory: nextMemory
          });
          return reply;
        }

        if (turn.cancelled) {
          const reply = turn.text || "任务已取消。";
          await saveSessionState(sessionId, {
            messages: [...sessionMessages, { role: "user", content: input }, { role: "assistant", content: reply }],
            memory: nextMemory
          });
          return reply;
        }

        const reply = turn.text || "我没有得到有效结果。";
        await saveSessionState(sessionId, {
          messages: [...sessionMessages, { role: "user", content: input }, { role: "assistant", content: reply }],
          memory: nextMemory
        });
        await rememberAgentEvolution(input, reply);
        return reply;
      }

      messages.push({
        role: "assistant",
        content: turn.text || "",
        toolCalls: turn.toolCalls
      });

      for (const toolCall of turn.toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.argumentsText) as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }

        logger.info(
          {
            sessionId,
            tool: toolCall.name,
            args: parsedArgs
          },
          "llm requested tool call"
        );

        let result: unknown;
        try {
          result = await executeTool(toolCall.name, parsedArgs);
        } catch (error) {
          result = {
            ok: false,
            error: error instanceof Error ? error.message : "unknown tool error"
          };
        }

        messages.push({
          role: "tool",
          name: toolCall.name,
          toolCallId: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }
  } catch (error) {
    logger.error(
      {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        provider: config.llm.provider
      },
      "llm provider failed"
    );

    return `LLM provider 调用失败：${error instanceof Error ? error.message : "unknown error"}`;
  }

  await saveSessionState(sessionId, {
    messages: [...sessionMessages, { role: "user", content: input }],
    memory: nextMemory
  });

  return "工具调用达到本轮上限，请缩小问题范围后重试。";
};

const rememberAgentEvolution = async (input: string, reply: string): Promise<void> => {
  const lessons = extractEvolutionNotes(input, reply);
  if (lessons.length === 0) {
    return;
  }

  await rememberAgentItems({
    category: "evolutionNotes",
    items: lessons
  });
};

const extractEvolutionNotes = (input: string, reply: string): string[] => {
  const candidates = [input, reply];
  const notes: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > 160) {
      continue;
    }

    if (/记住|remember|以后|下次|默认|always|default/i.test(trimmed)) {
      notes.push(trimmed);
    }
  }

  return notes;
};

const handleHintFallback = async (input: string): Promise<string> => {
  const hint = NATURAL_LANGUAGE_HINTS.find((item) => item.pattern.test(input));
  if (!hint) {
    return getLlmUnavailableReason();
  }

  const { runCommand } = await import("../lib/command.js");
  const outcome = await runCommand(hint.command);
  if (!outcome.ok) {
    return `工具调用被拒绝：${outcome.reason}`;
  }

  return formatCommandReply(hint.command, outcome.cwd, outcome.result);
};

export const formatCommandReply = (
  command: string,
  cwd: string,
  result: {
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    truncated: boolean;
  }
): string => {
  const parts = [
    `command: ${command}`,
    `cwd: ${cwd}`,
    `ok: ${result.ok}`,
    `exitCode: ${result.exitCode ?? "null"}`,
    `durationMs: ${result.durationMs}`
  ];

  if (result.stdout) {
    parts.push(`stdout:\n${result.stdout}`);
  }

  if (result.stderr) {
    parts.push(`stderr:\n${result.stderr}`);
  }

  if (result.truncated) {
    parts.push("note: output truncated");
  }

  return parts.join("\n");
};
