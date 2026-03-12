import { handleAgentMessage, formatCommandReply } from "./agent/runtime.js";
import { runCommand } from "./lib/command.js";

export const processIncomingText = async (text: string): Promise<string> => {
  if (!text) {
    return "empty or unsupported message";
  }

  if (text.startsWith("/run ")) {
    const command = text.slice(5).trim();
    const outcome = await runCommand(command);
    if (!outcome.ok) {
      return `command rejected: ${outcome.reason}`;
    }

    return formatCommandReply(command, outcome.cwd, outcome.result);
  }

  return handleAgentMessage(text);
};
