import { FastifyBaseLogger } from "fastify";

import { config } from "../config.js";
import { getLlmUnavailableReason, generateAssistantTurn, isLlmConfigured } from "../llm/provider.js";
import { loadSessionMessages, saveSessionMessages } from "../storage/session-store.js";
import { executeTool, toolDefinitions } from "../tools/registry.js";
import { ChatMessage } from "../types.js";

const NATURAL_LANGUAGE_HINTS = [
  { pattern: /当前目录|pwd|在哪里/i, command: "pwd" },
  { pattern: /哪些文件|列出文件|ls\b/i, command: "ls" },
  { pattern: /git 状态|git status/i, command: "git status --short --branch" }
];

const SYSTEM_PROMPT = [
  "You are blueclaw, a coding and automation assistant running inside a controlled workspace.",
  "Prefer using tools when the user asks about repository state, files, commands, or project changes.",
  "Be concise and practical.",
  "Only rely on tool results for repository-specific facts.",
  "If a tool fails, explain the failure briefly and continue if possible."
].join(" ");

export const handleAgentMessage = async ({
  input,
  sessionId,
  logger
}: {
  input: string;
  sessionId: string;
  logger: FastifyBaseLogger;
}): Promise<string> => {
  if (!isLlmConfigured()) {
    return handleHintFallback(input);
  }

  const sessionMessages = await loadSessionMessages(sessionId);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...sessionMessages,
    { role: "user", content: input }
  ];

  for (let step = 0; step < config.llm.maxSteps; step += 1) {
    const turn = await generateAssistantTurn({
      messages,
      tools: toolDefinitions
    });

    if (turn.toolCalls.length === 0) {
      const reply = turn.text || "我没有得到有效结果。";
      await saveSessionMessages(sessionId, [
        ...sessionMessages,
        { role: "user", content: input },
        { role: "assistant", content: reply }
      ]);
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

  return "工具调用达到本轮上限，请缩小问题范围后重试。";
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
