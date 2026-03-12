import { routeNaturalIntent } from "../intent-router.js";
import { CapabilityInvocation, PlannedAction } from "../capabilities/types.js";
import { requiresConfirmation } from "./policy.js";

const highRiskSummary = (steps: CapabilityInvocation[]): string =>
  steps.map((step, index) => `${index + 1}. ${step.summary}`).join("\n");

const toPlan = (steps: CapabilityInvocation[]): PlannedAction =>
  requiresConfirmation(steps)
    ? {
        kind: "confirm",
        summary: highRiskSummary(steps),
        steps
      }
    : {
        kind: "execute",
        steps
      };

export const planTextRequest = (text: string): PlannedAction => {
  if (text === "/diff") {
    return toPlan([{ capability: "repo.diff", summary: "查看当前代码改动" }]);
  }

  if (text === "/status" || text === "/tasks") {
    return toPlan([{ capability: "task.status", summary: "查看最近任务状态" }]);
  }

  if (text.startsWith("/task ")) {
    const request = text.slice(6).trim();
    return toPlan([{ capability: "task.execute", input: { request }, summary: `执行开发任务: ${request}` }]);
  }

  if (text.startsWith("/commit ")) {
    const message = text.slice(8).trim();
    return toPlan([{ capability: "repo.commit", input: { message }, summary: `提交当前改动，提交信息为: ${message}` }]);
  }

  if (text === "/push") {
    return toPlan([{ capability: "repo.push", summary: "将当前分支推送到远端" }]);
  }

  if (text === "/restart" || text === "重启服务" || text === "重启下服务") {
    return toPlan([{ capability: "service.restart", summary: "重启 blueclaw 服务" }]);
  }

  if (text === "/rollback") {
    return toPlan([{ capability: "service.rollback", summary: "回滚到最近一次成功重启记录的稳定版本" }]);
  }

  if (text.startsWith("/run ")) {
    const command = text.slice(5).trim();
    return toPlan([{ capability: "shell.exec", input: { command }, summary: `执行命令: ${command}` }]);
  }

  if (/打开浏览器|打开chrome|open browser|open chrome/i.test(text)) {
    return toPlan([{ capability: "desktop.open_browser", summary: "打开浏览器" }]);
  }

  const routed = routeNaturalIntent(text);
  switch (routed.type) {
    case "builtin":
      return planTextRequest(routed.command);
    case "inspect":
      return toPlan([{ capability: "system.inspect", input: { target: routed.target }, summary: `检查系统状态: ${routed.target}` }]);
    case "provider":
      return toPlan([
        {
          capability: routed.target === "codex-profile" ? "provider.codex_profile" : "provider.codex_runtime",
          summary: routed.target === "codex-profile" ? "查看 Codex provider 摘要" : "查看 Codex runtime 摘要"
        }
      ]);
    case "task":
      return toPlan([{ capability: "task.execute", input: { request: routed.request }, summary: `执行开发任务: ${routed.request}` }]);
    case "confirmable":
      return {
        kind: "confirm",
        summary: routed.summary,
        steps: [
          {
            capability:
              routed.action === "commit"
                ? "repo.commit"
                : routed.action === "push"
                  ? "repo.push"
                  : routed.action === "restart"
                    ? "service.restart"
                    : "service.rollback",
            input: routed.payload ? { message: routed.payload } : undefined,
            summary: routed.summary
          }
        ]
      };
    case "workflow":
      return {
        kind: "confirm",
        summary: routed.summary,
        steps: routed.steps.map((step) =>
          step.type === "task"
            ? { capability: "task.execute" as const, input: { request: step.request }, summary: step.summary }
            : {
                capability:
                  step.action === "commit"
                    ? "repo.commit"
                    : step.action === "push"
                      ? "repo.push"
                      : step.action === "restart"
                        ? "service.restart"
                        : "service.rollback",
                input: step.payload ? { message: step.payload } : undefined,
                summary: step.summary
              }
        )
      };
    case "none":
    default:
      return { kind: "agent" };
  }
};
