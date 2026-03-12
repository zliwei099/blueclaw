import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { config } from "../../config.js";
import { AssistantTurn, ChatMessage, ToolDefinition } from "../../types.js";

const execFileAsync = promisify(execFile);

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
  const tempDir = await mkdtemp(join(tmpdir(), "blueclaw-codex-"));
  const outputPath = join(tempDir, "last-message.txt");
  const promptText = buildPrompt(messages, tools);

  try {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      config.llm.codexSandbox,
      "--output-last-message",
      outputPath,
      "--color",
      "never",
      "-C",
      config.workspaceRoot
    ];

    if (config.llm.codexFullAuto) {
      args.push("--full-auto");
    }

    if (config.llm.model) {
      args.push("--model", config.llm.model);
    }

    args.push(promptText);

    await execFileAsync(config.llm.codexBin, args, {
      cwd: config.workspaceRoot,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    });

    await access(outputPath);
    const output = (await readFile(outputPath, "utf8")).trim();

    return {
      text: output || "Codex 没有返回有效内容。",
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
