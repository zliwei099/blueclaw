import { FastifyBaseLogger } from "fastify";

import { executeCapability } from "../capabilities/registry.js";
import { CapabilityInvocation } from "../capabilities/types.js";

export const executeCapabilityPlan = async ({
  steps,
  logger,
  taskId,
  onProgress
}: {
  steps: CapabilityInvocation[];
  logger: FastifyBaseLogger;
  taskId: string;
  onProgress?: (message: string) => Promise<void>;
}): Promise<string> => {
  const results: string[] = [];

  for (const [index, step] of steps.entries()) {
    await onProgress?.(`执行能力步骤 ${index + 1}/${steps.length}: ${step.summary}`);
    const result = await executeCapability({
      invocation: step,
      logger,
      taskId: `${taskId}-${index + 1}`,
      onProgress
    });
    results.push([`步骤 ${index + 1}: ${step.summary}`, result].join("\n"));
  }

  return steps.length === 1 ? results[0] : ["执行计划已完成。", "", ...results].join("\n\n");
};
