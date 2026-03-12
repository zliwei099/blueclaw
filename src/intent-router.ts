export type RoutedIntent =
  | { type: "builtin"; command: string }
  | { type: "confirmable"; action: "commit" | "push" | "restart" | "rollback"; payload?: string; summary: string }
  | { type: "task"; request: string }
  | { type: "none" };

const includesAny = (text: string, patterns: string[]): boolean =>
  patterns.some((pattern) => text.includes(pattern));

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

  const commitMatch =
    text.match(/提交(?:这些)?改动(?:，|,|:)?\s*(?:提交信息是|commit message(?: is)?|message(?: is)?)?\s*(.+)$/i) ??
    text.match(/commit(?: these changes)?(?: with message)?[:：]?\s*(.+)$/i);
  if (commitMatch?.[1]) {
    const message = commitMatch[1].trim();
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

  if (
    includesAny(text, ["重启服务", "重启下服务", "重启一下", "帮我重启"]) ||
    includesAny(lower, ["restart service", "restart blueclaw"])
  ) {
    return {
      type: "confirmable",
      action: "restart",
      summary: "重启 blueclaw 服务"
    };
  }

  if (
    includesAny(text, ["回滚", "回退到上一个稳定版本", "恢复上一个稳定版本"]) ||
    includesAny(lower, ["rollback", "roll back"])
  ) {
    return {
      type: "confirmable",
      action: "rollback",
      summary: "回滚到最近一次成功重启记录的稳定版本"
    };
  }

  if (
    includesAny(text, ["帮我", "请帮我", "实现", "修复", "改一下", "加一个", "优化", "重构"]) ||
    includesAny(lower, ["implement", "fix", "refactor", "add ", "improve"])
  ) {
    return {
      type: "task",
      request: text
    };
  }

  return { type: "none" };
};
