import { ConfirmableActionType, PendingWorkflowStep } from "./confirmation-store.js";

export type RoutedIntent =
  | { type: "builtin"; command: string }
  | { type: "inspect"; target: "service" | "disk" | "ports" }
  | { type: "confirmable"; action: ConfirmableActionType; payload?: string; summary: string }
  | { type: "workflow"; summary: string; steps: PendingWorkflowStep[] }
  | { type: "task"; request: string }
  | { type: "none" };

const includesAny = (text: string, patterns: string[]): boolean =>
  patterns.some((pattern) => text.includes(pattern));

const COMMIT_PATTERNS = ["提交", "commit"];
const PUSH_PATTERNS = ["推到远端", "推送到远端", "推到github", "推送到github", " push", "git push"];
const RESTART_PATTERNS = ["重启服务", "重启下服务", "重启一下", "帮我重启", "restart service", "restart blueclaw"];
const ROLLBACK_PATTERNS = ["回滚", "回退到上一个稳定版本", "恢复上一个稳定版本", "rollback", "roll back"];
const TASK_PATTERNS = ["帮我", "请帮我", "实现", "修复", "改一下", "加一个", "优化", "重构", "implement", "fix", "refactor", "add ", "improve"];

const extractCommitMessage = (text: string): string | undefined => {
  const commitMatch =
    text.match(/提交(?:这些)?改动(?:，|,|:)?\s*(?:提交信息是|commit message(?: is)?|message(?: is)?)?\s*(.+)$/i) ??
    text.match(/commit(?: these changes)?(?: with message)?[:：]?\s*(.+)$/i);

  return commitMatch?.[1]
    ?.split(/(?:然后|并且|并|接着|再|之后)\s*/i)[0]
    ?.replace(/[，。,.\s]+$/g, "")
    .trim();
};

const extractTaskRequest = (text: string): string | undefined => {
  if (/^(?:帮我|请帮我)?\s*(?:提交|commit|推送|push|重启|restart|回滚|rollback)/i.test(text.trim())) {
    return undefined;
  }

  const cleaned = text
    .replace(/然后|并且|并|接着|再|之后|完成后/gi, " ")
    .replace(/(提交(?:这些)?改动.*|commit(?: these changes)?.*|推(?:送)?到?(?:远端|github).*|git push.*|重启(?:下)?服务.*|restart service.*|回滚.*|rollback.*)$/i, "")
    .trim()
    .replace(/[，。,.\s]+$/g, "")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return includesAny(cleaned, TASK_PATTERNS) ? cleaned : undefined;
};

const buildWorkflowSummary = (steps: PendingWorkflowStep[]): string =>
  steps
    .map((step, index) => `${index + 1}. ${step.summary}`)
    .join("\n");

export const routeNaturalIntent = (input: string): RoutedIntent => {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (!text) {
    return { type: "none" };
  }

  if (text.startsWith("/")) {
    return { type: "none" };
  }

  if (
    includesAny(text, ["看看当前改动", "查看改动", "看看改动", "当前 diff", "当前变更", "未提交改动"]) ||
    includesAny(lower, ["show diff", "show changes"])
  ) {
    return { type: "builtin", command: "/diff" };
  }

  if (
    includesAny(text, ["看看最近任务", "任务状态", "当前状态", "最近任务"]) ||
    includesAny(lower, ["status", "recent tasks"])
  ) {
    return { type: "builtin", command: "/status" };
  }

  if (
    includesAny(text, ["看看服务状态", "检查服务状态", "运行状态", "环境状态"]) ||
    includesAny(lower, ["service status", "runtime status"])
  ) {
    return { type: "inspect", target: "service" };
  }

  if (
    includesAny(text, ["看看磁盘", "磁盘情况", "磁盘状态", "硬盘空间"]) ||
    includesAny(lower, ["disk status", "disk usage"])
  ) {
    return { type: "inspect", target: "disk" };
  }

  if (
    includesAny(text, ["看看端口", "监听端口", "端口情况"]) ||
    includesAny(lower, ["listening ports", "open ports"])
  ) {
    return { type: "inspect", target: "ports" };
  }

  const hasCommit = includesAny(text, COMMIT_PATTERNS) || includesAny(lower, COMMIT_PATTERNS);
  const hasPush = includesAny(text, PUSH_PATTERNS) || includesAny(lower, PUSH_PATTERNS);
  const hasRestart = includesAny(text, RESTART_PATTERNS) || includesAny(lower, RESTART_PATTERNS);
  const hasRollback = includesAny(text, ROLLBACK_PATTERNS) || includesAny(lower, ROLLBACK_PATTERNS);
  const commitMessage = extractCommitMessage(text);
  const taskRequest = extractTaskRequest(text);

  const workflowSteps: PendingWorkflowStep[] = [];
  if (taskRequest) {
    workflowSteps.push({
      type: "task",
      request: taskRequest,
      summary: `执行开发任务: ${taskRequest}`
    });
  }

  if (commitMessage) {
    workflowSteps.push({
      type: "action",
      action: "commit",
      payload: commitMessage,
      summary: `提交当前改动，提交信息为: ${commitMessage}`
    });
  } else if (hasCommit && taskRequest) {
    workflowSteps.push({
      type: "action",
      action: "commit",
      payload: "chore: update via blueclaw",
      summary: "提交当前改动，提交信息为默认文案"
    });
  }

  if (hasPush) {
    workflowSteps.push({
      type: "action",
      action: "push",
      summary: "将当前分支推送到远端"
    });
  }

  if (hasRestart) {
    workflowSteps.push({
      type: "action",
      action: "restart",
      summary: "重启 blueclaw 服务"
    });
  }

  if (workflowSteps.length >= 2) {
    return {
      type: "workflow",
      summary: buildWorkflowSummary(workflowSteps),
      steps: workflowSteps
    };
  }

  if (commitMessage) {
    const message = commitMessage;
    return {
      type: "confirmable",
      action: "commit",
      payload: message,
      summary: `提交当前改动，提交信息为: ${message}`
    };
  }

  if (
    includesAny(text, ["推到远端", "推送到远端", "推到github", "推送到github", "帮我 push"]) ||
    includesAny(lower, ["push to remote", "git push", "push it"])
  ) {
    return {
      type: "confirmable",
      action: "push",
      summary: "将当前分支推送到远端"
    };
  }

  if (hasRestart) {
    return {
      type: "confirmable",
      action: "restart",
      summary: "重启 blueclaw 服务"
    };
  }

  if (hasRollback) {
    return {
      type: "confirmable",
      action: "rollback",
      summary: "回滚到最近一次成功重启记录的稳定版本"
    };
  }

  if (includesAny(text, TASK_PATTERNS) || includesAny(lower, TASK_PATTERNS)) {
    return {
      type: "task",
      request: text
    };
  }

  return { type: "none" };
};
