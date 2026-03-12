import { spawn } from "node:child_process";
import { FastifyBaseLogger } from "fastify";

let restartScheduled = false;

export const scheduleServiceRestart = (logger: FastifyBaseLogger): boolean => {
  if (restartScheduled) {
    return false;
  }

  restartScheduled = true;

  const command = [
    "sleep 1",
    `cd ${shellQuote(process.cwd())}`,
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
