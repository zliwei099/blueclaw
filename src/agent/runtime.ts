import { runCommand } from "../lib/command.js";

const NATURAL_LANGUAGE_HINTS = [
  { pattern: /当前目录|pwd|在哪里/i, command: "pwd" },
  { pattern: /哪些文件|列出文件|ls\b/i, command: "ls" },
  { pattern: /git 状态|git status/i, command: "git status --short --branch" }
];

export const handleAgentMessage = async (input: string): Promise<string> => {
  const hint = NATURAL_LANGUAGE_HINTS.find((item) => item.pattern.test(input));
  if (!hint) {
    return [
      "我目前只支持最小能力集。",
      "可直接发送 `/run <command>`，或使用类似“看看当前目录有哪些文件”“帮我看 git 状态”的请求。"
    ].join("\n");
  }

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
