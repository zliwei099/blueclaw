import { CAPABILITY_RISK } from "../capabilities/registry.js";
import { CapabilityInvocation } from "../capabilities/types.js";

export const requiresConfirmation = (steps: CapabilityInvocation[]): boolean =>
  steps.some((step) => CAPABILITY_RISK[step.capability] === "high");
