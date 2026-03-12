import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { config } from "../config.js";

export type SkillEntry = {
  id: string;
  title: string;
  description: string;
  root: string;
  file: string;
};

const walkForSkillFiles = async (current: string): Promise<string[]> => {
  const entries = await readdir(current, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkForSkillFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name === "SKILL.md") {
      results.push(fullPath);
    }
  }

  return results;
};

const parseSkillHeader = (raw: string, file: string): { title: string; description: string } => {
  const lines = raw.split("\n").map((line) => line.trim());
  const title =
    lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") ??
    basename(dirname(file));
  const description =
    lines.find((line) => line && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("```")) ??
    "No description available.";

  return { title, description };
};

export const loadSkillCatalog = async (): Promise<SkillEntry[]> => {
  const files = (
    await Promise.all(
      config.skillRoots.map(async (root) => {
        try {
          return await walkForSkillFiles(root);
        } catch {
          return [];
        }
      })
    )
  ).flat();

  const entries = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(file, "utf8");
      const parsed = parseSkillHeader(raw, file);
      const root = config.skillRoots.find((value) => file.startsWith(value)) ?? dirname(file);
      return {
        id: relative(root, dirname(file)).replaceAll("\\", "/") || basename(dirname(file)),
        title: parsed.title,
        description: parsed.description,
        root,
        file
      } satisfies SkillEntry;
    })
  );

  return entries.sort((a, b) => a.id.localeCompare(b.id));
};

export const readSkillContent = async (skillId: string): Promise<{ skill: SkillEntry; content: string }> => {
  const catalog = await loadSkillCatalog();
  const skill = catalog.find((entry) => entry.id === skillId || entry.title === skillId);
  if (!skill) {
    throw new Error(`skill '${skillId}' not found`);
  }

  const content = await readFile(skill.file, "utf8");
  return { skill, content };
};

export const formatSkillCatalog = (skills: SkillEntry[]): string =>
  skills
    .slice(0, 12)
    .map((skill) => `- ${skill.id}: ${skill.description}`)
    .join("\n");
