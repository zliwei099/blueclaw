import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { config } from "../config.js";

const withinWorkspace = (target: string): boolean => {
  const rel = relative(config.workspaceRoot, target);
  return rel === "" || (!rel.startsWith("..") && !rel.includes("../"));
};

const resolveWorkspacePath = (pathValue = "."): string => resolve(config.workspaceRoot, pathValue);

export const readWorkspaceFile = async ({
  path,
  maxBytes = 8_192
}: {
  path: string;
  maxBytes?: number;
}): Promise<{ path: string; content: string; truncated: boolean }> => {
  const absolutePath = resolveWorkspacePath(path);
  if (!withinWorkspace(absolutePath)) {
    throw new Error("path is outside workspace root");
  }

  const content = await readFile(absolutePath, "utf8");
  return {
    path: absolutePath,
    content: content.slice(0, maxBytes),
    truncated: content.length > maxBytes
  };
};

export const listWorkspaceFiles = async ({
  path = ".",
  limit = 100
}: {
  path?: string;
  limit?: number;
}): Promise<{ path: string; entries: string[]; truncated: boolean }> => {
  const absolutePath = resolveWorkspacePath(path);
  if (!withinWorkspace(absolutePath)) {
    throw new Error("path is outside workspace root");
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const mapped = entries
    .slice(0, limit)
    .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${join(path, entry.name)}`);

  return {
    path: absolutePath,
    entries: mapped,
    truncated: entries.length > limit
  };
};
