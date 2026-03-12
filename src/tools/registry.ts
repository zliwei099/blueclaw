import { runCommand } from "../lib/command.js";
import { loadSkillCatalog, readSkillContent } from "../skills/catalog.js";
import { loadAgentMemory, rememberAgentItems } from "../storage/agent-memory.js";
import { inspectSystemTarget } from "../system-inspect.js";
import { listWorkspaceFiles, readWorkspaceFile } from "./workspace.js";
import { ToolDefinition } from "../types.js";

type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

const toolExecutors = new Map<string, ToolExecutor>([
  [
    "memory.get",
    async () => loadAgentMemory()
  ],
  [
    "memory.remember",
    async (args) =>
      rememberAgentItems({
        category:
          args.category === "operatorProfile" ||
          args.category === "preferences" ||
          args.category === "environmentFacts" ||
          args.category === "evolutionNotes"
            ? args.category
            : "evolutionNotes",
        items: Array.isArray(args.items) ? args.items.map((item) => String(item)) : [String(args.item ?? "")]
      })
  ],
  [
    "skill.list",
    async () => loadSkillCatalog()
  ],
  [
    "skill.read",
    async (args) => readSkillContent(String(args.skillId ?? ""))
  ],
  [
    "system.inspect",
    async (args) =>
      inspectSystemTarget(
        args.target === "disk" || args.target === "ports" || args.target === "service" ? args.target : "service"
      )
  ],
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
    name: "memory.get",
    description: "Read the agent's persistent long-term memory about operator preferences, environment facts, and evolution notes.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "memory.remember",
    description: "Store durable long-term memory items for future conversations.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["operatorProfile", "preferences", "environmentFacts", "evolutionNotes"]
        },
        items: {
          type: "array",
          items: { type: "string" }
        },
        item: { type: "string" }
      }
    }
  },
  {
    name: "skill.list",
    description: "List installed skills available to the agent.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "skill.read",
    description: "Read the full instructions for a specific installed skill.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "Skill id from skill.list." }
      },
      required: ["skillId"]
    }
  },
  {
    name: "system.inspect",
    description: "Inspect high-level runtime, disk, or listening port state on this machine.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["service", "disk", "ports"]
        }
      }
    }
  },
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
