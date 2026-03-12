import Fastify, { FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";
import "dotenv/config";

import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: {
              translateTime: "SYS:standard",
              ignore: "pid,hostname"
            }
          }
    }
  });

  registerRoutes(app);
  return app;
};

const start = async (): Promise<void> => {
  const app = buildApp();

  try {
    await app.listen({
      port: config.port,
      host: config.host
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void start();
}
