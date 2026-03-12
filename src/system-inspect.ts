import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { config } from "./config.js";

const execFileAsync = promisify(execFile);

const runBinary = async (
  binary: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  try {
    const result = await execFileAsync(binary, args, {
      cwd: config.projectRoot,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message
    };
  }
};

const summarize = (title: string, result: { ok: boolean; stdout: string; stderr: string }): string =>
  [
    `${title}: ${result.ok ? "ok" : "failed"}`,
    result.stdout.trim(),
    !result.ok ? result.stderr.trim() : ""
  ]
    .filter(Boolean)
    .join("\n");

export const inspectSystemTarget = async (target: "service" | "disk" | "ports"): Promise<string> => {
  switch (target) {
    case "service": {
      const branch = await runBinary("git", ["status", "--short", "--branch"]);
      const node = await runBinary("node", ["-v"]);
      const npm = await runBinary("npm", ["-v"]);
      return [summarize("git", branch), "", summarize("node", node), "", summarize("npm", npm)].join("\n");
    }
    case "disk": {
      const disk = await runBinary("df", ["-h", config.projectRoot]);
      return summarize("disk", disk);
    }
    case "ports": {
      const ports = await runBinary("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]);
      return summarize("ports", ports);
    }
  }
};
