import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { config } from "./config.js";
import { TaskRecord } from "./types.js";

const storePath = join(config.sessionStoreDir, "tasks.json");

type TaskStorePayload = {
  tasks: TaskRecord[];
  updatedAt: string;
};

export const loadTaskRecords = async (): Promise<TaskRecord[]> => {
  try {
    const raw = await readFile(storePath, "utf8");
    const payload = JSON.parse(raw) as TaskStorePayload;
    return payload.tasks ?? [];
  } catch {
    return [];
  }
};

export const saveTaskRecords = async (tasks: TaskRecord[]): Promise<void> => {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(
      {
        tasks: tasks.slice(0, 200),
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};
