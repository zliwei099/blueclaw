import { runCommand } from "../lib/command.js";
import { listWorkspaceFiles, readWorkspaceFile } from "./workspace.js";
import { ToolDefinition } from "../types.js";

type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

const toolExecutors = new Map<string, ToolExecutor>([
  [
    "shell.exec",
    async (args) => {
      const command = String(args.command ?? "");
      const cwd = typeof args.cwd === "string" ? args.cwd : undefined;
      const result = await runCommand(command, cwd);
      return result.ok ? result : { ok: false, reason: result.reason };
    }
  ],
  [
    "workspace.read_file",
    async (args) =>
      readWorkspaceFile({
        path: String(args.path ?? ""),
        maxBytes: typeof args.maxBytes === "number" ? args.maxBytes : undefined
      })
  ],
  [
    "workspace.list_files",
    async (args) =>
      listWorkspaceFiles({
        path: typeof args.path === "string" ? args.path : ".",
        limit: typeof args.limit === "number" ? args.limit : undefined
      })
  ]
]);

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "shell.exec",
    description: "Run a workspace-safe shell command using the built-in policy guard.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute." },
        cwd: { type: "string", description: "Optional cwd inside workspace root." }
      },
      required: ["command"]
    }
  },
  {
    name: "workspace.read_file",
    description: "Read a text file inside the workspace root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path inside workspace root." },
        maxBytes: { type: "number", description: "Maximum bytes to return." }
      },
      required: ["path"]
    }
  },
  {
    name: "workspace.list_files",
    description: "List files or directories inside the workspace root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path inside workspace root." },
        limit: { type: "number", description: "Maximum number of entries to return." }
      }
    }
  }
];

export const executeTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const tool = toolExecutors.get(name);
  if (!tool) {
    throw new Error(`unknown tool '${name}'`);
  }

  return tool(args);
};
