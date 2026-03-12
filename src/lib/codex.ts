import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export const runCodexExec = async ({
  prompt,
  cwd = config.projectRoot,
  timeoutMs = 10 * 60 * 1000
}: {
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ text: string; stdout: string; stderr: string }> => {
  const tempDir = await mkdtemp(join(tmpdir(), "blueclaw-codex-"));
  const outputPath = join(tempDir, "last-message.txt");

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
      cwd
    ];

    if (config.llm.codexFullAuto) {
      args.push("--full-auto");
    }

    if (config.llm.model) {
      args.push("--model", config.llm.model);
    }

    args.push(prompt);

    const { stdout, stderr } = await execFileAsync(config.llm.codexBin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });

    await access(outputPath);
    const text = (await readFile(outputPath, "utf8")).trim();

    return {
      text: text || "Codex 没有返回有效内容。",
      stdout,
      stderr
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
