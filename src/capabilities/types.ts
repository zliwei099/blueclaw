export type CapabilityId =
  | "repo.diff"
  | "task.status"
  | "task.execute"
  | "repo.commit"
  | "repo.push"
  | "service.restart"
  | "service.rollback"
  | "system.inspect"
  | "provider.codex_profile"
  | "provider.codex_runtime"
  | "shell.exec"
  | "desktop.open_browser";

export type CapabilityInvocation = {
  capability: CapabilityId;
  input?: Record<string, unknown>;
  summary: string;
};

export type PlannedAction =
  | {
      kind: "execute";
      steps: CapabilityInvocation[];
    }
  | {
      kind: "confirm";
      summary: string;
      steps: CapabilityInvocation[];
    }
  | {
      kind: "agent";
    };
