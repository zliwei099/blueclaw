# blueclaw

一个面向后续深度定制的简易版 OpenClaw 设计方案。目标不是一开始做全，而是先打通两条链路：

1. 飞书消息接入
2. 命令行工具调用

在此基础上逐步补齐 Agent 编排、权限、记忆、插件和可观测性。

## 当前实现状态

仓库当前已经落了 Phase 1 的最小代码骨架：

- Fastify HTTP 服务
- `GET /healthz`
- `POST /webhooks/feishu/events`
- 飞书 WebSocket 长连事件接入
- OpenAI 兼容 LLM 适配器
- 文件级会话存储
- 工具注册表与工具调用闭环
- `/run <command>` 命令执行
- 基础命令白名单和 shell 操作符拦截
- 飞书回消息客户端
- 本地 smoke 验证脚本

当前默认行为：

- 默认使用飞书 `websocket` 长连模式，更适合本地开发
- 如果配置了飞书 `app_id` / `app_secret`，收到消息后会调用飞书回复接口
- 如果未配置飞书凭证，会返回降级响应，方便本地联调
- 如果 `WORKSPACE_ROOT` 不存在，会自动回退到当前项目目录
- 如果设置 `FEISHU_EVENT_MODE=webhook`，则只使用 webhook 模式
- 如果设置 `FEISHU_EVENT_MODE=both`，则同时保留 webhook 和 websocket
- 如果配置了 `LLM_PROVIDER=openai-compatible` 以及对应的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，自然语言消息会进入 LLM Agent 模式
- 如果未配置 LLM，则自然语言消息仍走规则兜底

## 飞书通信方式

当前代码支持两种飞书事件入口：

1. WebSocket 长连

- 代码入口：[src/adapters/feishu-ws.ts](/Users/levy/dev/codex/blueclaw/src/adapters/feishu-ws.ts)
- 服务主动连接飞书，不需要公网 webhook
- 推荐作为本地开发默认模式

2. Webhook 回调

- 代码入口：[src/routes.ts](/Users/levy/dev/codex/blueclaw/src/routes.ts)
- 飞书把事件推送到 `POST /webhooks/feishu/events`
- 更适合部署到公网后的生产接入

两种入口最终都会汇总到统一消息路由：

- [src/message-router.ts](/Users/levy/dev/codex/blueclaw/src/message-router.ts)

## LLM Agent

当前已经接入一个最小可用的 LLM Agent 闭环：

1. 飞书消息进入统一消息路由
2. 非 `/run` 文本进入 [src/agent/runtime.ts](/Users/levy/dev/codex/blueclaw/src/agent/runtime.ts)
3. Runtime 从 [src/storage/session-store.ts](/Users/levy/dev/codex/blueclaw/src/storage/session-store.ts) 读取最近会话
4. 调用 [src/llm/openai-compatible.ts](/Users/levy/dev/codex/blueclaw/src/llm/openai-compatible.ts)
5. 模型可选择调用工具：
   - [src/tools/registry.ts](/Users/levy/dev/codex/blueclaw/src/tools/registry.ts)
   - `shell.exec`
   - `workspace.read_file`
   - `workspace.list_files`
6. 工具结果回填给模型，生成最终回复

会话默认保存在：

- `.blueclaw/sessions/`

### LLM 配置

需要配置：

```env
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=你的_openai_api_key
LLM_MODEL=gpt-5.4
LLM_MAX_STEPS=4
SESSION_STORE_DIR=.blueclaw/sessions
```

说明：

- `LLM_PROVIDER` 当前支持：
  - `openai-compatible`
  - `openai-codex`（已预留入口，尚未接入）
- `LLM_BASE_URL` 应指向 OpenAI 兼容接口前缀，当前代码会拼接 `/chat/completions`
- `LLM_MODEL` 由你选择的模型提供方决定
- `LLM_MAX_STEPS` 控制单轮最多工具调用回合数
- 当前机器上的 Codex 本地配置默认模型是 `gpt-5.4`
- 当前机器上的 Codex 登录模式是 `chatgpt`，没有可直接复用的 `OPENAI_API_KEY`

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

3. 启动服务

```bash
npm run build
node dist/index.js
```

4. 类型检查和构建

```bash
npm run check
npm run build
```

5. 运行本地 smoke 验证

```bash
node dist/smoke.js
```

## 1. 目标边界

第一阶段只解决下面几件事：

- 用户在飞书里发消息
- 服务收到消息并解析指令
- Agent 决定是否调用本地命令行工具
- 工具执行结果回传到飞书
- 保留最基本的日志、会话上下文和安全控制

暂时不做：

- 复杂多 Agent 协作
- 长期记忆
- 向量检索
- 自定义工作流编辑器
- 多租户权限系统
- 复杂前端控制台

## 2. 推荐总体架构

建议先做一个单进程、模块化的服务，避免一上来拆太细。

```text
Feishu Bot
   |
Webhook / Polling
   |
HTTP API Server
   |
Message Router
   |
Agent Runtime
   |------ LLM Adapter
   |------ Tool Registry
   |------ Session Store
   |------ Policy Guard
   |
Command Runner
   |
Result Formatter
   |
Reply to Feishu
```

## 3. 模块拆分

### 3.1 `feishu-adapter`

职责：

- 接收飞书事件回调
- 校验签名、解密消息
- 发送回复消息
- 处理重试、去重、消息 ACK

建议接口：

- `receiveEvent(req) -> Event`
- `sendMessage(chatId, content) -> MessageId`
- `replyMessage(messageId, content)`

### 3.2 `agent-runtime`

职责：

- 把用户输入转成统一任务
- 维护单轮或多轮会话上下文
- 让模型决定是直接回复还是调用工具
- 管理工具调用结果回填

第一版建议尽量简单：

- 只支持单 Agent
- 只支持同步工具调用
- 只保留最近 N 轮上下文

### 3.3 `tool-registry`

职责：

- 注册工具元信息
- 暴露给 LLM 的工具 schema
- 根据工具名路由到实际执行器

建议先只做两类工具：

- `shell.exec`: 执行允许范围内的命令
- `shell.read_file`: 读取工作目录内文件，方便后续让 Agent 基于文件内容决策

### 3.4 `command-runner`

职责：

- 真正执行命令
- 控制超时、工作目录、环境变量、输出截断
- 过滤危险命令
- 返回标准化结果

返回结构建议：

```json
{
  "ok": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "duration_ms": 120,
  "truncated": false
}
```

### 3.5 `policy-guard`

职责：

- 拦截高风险命令
- 控制允许访问的目录
- 控制单次输出长度
- 控制单会话最大调用次数

第一版建议白名单优先，不要黑名单优先。

例如允许：

- `pwd`
- `ls`
- `cat`
- `rg`
- `git status`
- `git diff`
- `python script.py`

默认禁止：

- `rm`
- `sudo`
- `curl | sh`
- 后台常驻进程
- 任意网络访问

### 3.6 `session-store`

第一阶段可直接用 SQLite。

建议存：

- 会话 ID
- 飞书用户 ID
- 原始消息
- Agent 中间决策
- 工具调用记录
- 最终回复

这部分后面很容易升级到 PostgreSQL。

## 4. 推荐技术栈

如果你希望后面扩展成偏工程化的 Agent 平台，建议直接用 TypeScript。

推荐：

- Runtime: Node.js 20+
- Web framework: Fastify
- Validation: Zod
- DB: SQLite + Prisma 或 Drizzle
- HTTP client: undici
- Logging: pino
- Queue: 第一版先不引入，后面再补 BullMQ

这样做的原因：

- 飞书 SDK 和 Node 生态更顺手
- 做 tool schema、JSON 结构、流式响应都方便
- 后续接 MCP、WebSocket、前端控制台也自然

如果你更偏本地自动化和 AI 工具实验，也可以选 Python，但从“后续逐步工程化”角度，我更推荐 TypeScript。

## 5. MVP 交付范围

第一版建议限制到下面这个闭环：

### 用户侧能力

- 飞书私聊机器人
- 支持文本消息
- 支持 `/run <command>` 直接执行命令
- 支持自然语言触发简单 Agent

示例：

- `/run pwd`
- `/run git status`
- `帮我看看当前目录有哪些文件`

### Agent 侧能力

- 识别是否需要调用工具
- 最多调用 1 到 3 次工具
- 汇总结果后回复飞书

### 安全侧能力

- 命令白名单
- 工作目录白名单
- 超时 10 秒
- 输出上限 8KB
- 会话审计日志

## 6. 建议的请求流

### 6.1 直接命令模式

```text
Feishu Message
  -> Router detects /run
  -> Policy Guard validates command
  -> Command Runner executes
  -> Format result
  -> Reply to Feishu
```

这是最先要打通的链路，因为最容易验证。

### 6.2 Agent 模式

```text
Feishu Message
  -> Router sends user input to Agent Runtime
  -> LLM decides whether to call tool
  -> Tool Registry dispatches shell.exec
  -> Command Runner returns result
  -> LLM summarizes result
  -> Reply to Feishu
```

## 7. 推荐目录结构

```text
blueclaw/
  apps/
    server/
      src/
        index.ts
        config/
        routes/
        adapters/
          feishu/
        agent/
        tools/
        security/
        storage/
        lib/
  packages/
    shared/
      src/
        types/
        schemas/
  docs/
    architecture.md
    roadmap.md
```

如果第一阶段只有一个服务，也可以先不用 monorepo，后面再拆。

## 8. 核心接口设计

### 8.1 Tool 定义

```ts
type ToolDefinition<TArgs = unknown, TResult = unknown> = {
  name: string;
  description: string;
  inputSchema: TArgs;
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
};
```

### 8.2 Agent 执行结果

```ts
type AgentTurnResult = {
  reply: string;
  toolCalls: Array<{
    toolName: string;
    args: unknown;
    result: unknown;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
};
```

### 8.3 Shell 工具参数

```ts
type ShellExecInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
};
```

## 9. 安全设计建议

这是这个项目最容易失控的部分，第一天就要定规则。

建议：

- 命令执行必须经过显式策略校验
- 默认不允许联网
- 默认不允许跨出工作目录
- 默认不允许 shell 组合符，如 `&&`、`|`、`;`、`$()`
- 默认不允许交互式命令
- 默认不允许写系统目录
- 默认只返回截断后的输出

实现上可以分三层：

1. 输入校验：检查命令格式
2. 策略校验：检查是否在白名单
3. 执行隔离：子进程超时、中断、目录限制

## 10. 分阶段实施路线

### Phase 1: 打通链路

目标：

- 飞书 bot 能收发消息
- `/run` 命令能执行白名单命令
- 执行结果能回飞书

产出：

- `feishu-adapter`
- `command-runner`
- `policy-guard`
- 基础日志

### Phase 2: 加入 Agent 决策

目标：

- 支持自然语言触发工具调用
- 模型可决定调用 `shell.exec`
- 支持简单多轮上下文

产出：

- `agent-runtime`
- `tool-registry`
- `session-store`

### Phase 3: 增加可定制能力

目标：

- 支持新增工具
- 支持项目级 prompt / policy
- 支持不同命令模板

产出：

- 工具插件机制
- 配置中心
- Prompt 模板系统

### Phase 4: 工程化增强

目标：

- 更强的审计和权限
- 异步任务
- 更完整的观测和告警

产出：

- Job queue
- Metrics / tracing
- 管理后台

## 11. 最小配置项

建议从 `.env` 管理：

```env
PORT=3000
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_ENCRYPT_KEY=
FEISHU_VERIFICATION_TOKEN=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
WORKSPACE_ROOT=/srv/blueclaw/workspace
COMMAND_TIMEOUT_MS=10000
COMMAND_OUTPUT_LIMIT=8192
```

## 12. 里程碑建议

建议按下面顺序推进，每一步都可独立验收：

1. 本地 HTTP 服务启动
2. 飞书 webhook 验签成功
3. `/run pwd` 能返回结果
4. `/run git status` 能返回结果
5. 自然语言请求可触发一次工具调用
6. 多轮上下文可保留最近 5 轮
7. 增加一个自定义工具，例如 `project.search`

## 13. 我对实现方式的建议

如果你的目标是“做一个方便后续定制的简易版 OpenClaw”，最优策略不是先追求完整 Agent 能力，而是先把“飞书 + 受控命令执行 + 最小 Agent 循环”这三层做扎实。

具体建议：

- 第一周只做 `/run`
- 第二周加 LLM 决策和 `shell.exec`
- 第三周加会话存储和插件化工具注册

这样每一周都能得到一个真实可用的版本，而不是陷入大而全设计。

## 14. 下一步建议

如果你认可这个方向，下一步我建议直接开始搭第一版脚手架，优先落下面这些文件：

- `package.json`
- `src/index.ts`
- `src/adapters/feishu/*`
- `src/tools/shell.exec.ts`
- `src/security/policy.ts`
- `src/agent/runtime.ts`

这样可以直接进入 Phase 1 开发。
