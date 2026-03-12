import { spawn } from "node:child_process";
import { FastifyBaseLogger } from "fastify";

import { config } from "./config.js";

let restartScheduled = false;

export const scheduleServiceRestart = (logger: FastifyBaseLogger): boolean => {
  if (restartScheduled) {
    return false;
  }

  restartScheduled = true;

  const command = [
    "sleep 2",
    `cd ${shellQuote(process.cwd())}`,
    `export PORT=${shellQuote(String(config.port))}`,
    `export HOST=${shellQuote(config.host)}`,
    `exec ${shellQuote(process.execPath)} dist/index.js >> .blueclaw/restart.log 2>&1`
  ].join("; ");

  const child = spawn("/bin/sh", ["-lc", command], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  logger.warn("service restart scheduled");

  setTimeout(() => {
    process.exit(0);
  }, 1500);

  return true;
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
