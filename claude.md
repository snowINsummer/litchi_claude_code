# Claude Code 2.1.88 源码架构深度分析

> 本文基于 Claude Code 2.1.88 源码逆向恢复版本，旨在拆解其核心链路与模块实现，供自建 Agent 参考。

---

## 一、项目总览

### 1.1 技术栈

| 层面 | 技术选型 |
|------|---------|
| 运行时 | Bun (TypeScript) |
| UI 框架 | Ink + React (终端 TUI) |
| AI SDK | @anthropic-ai/sdk |
| CLI 框架 | Commander.js |
| 数据校验 | Zod |
| 构建 | bun:bundle (编译时特性开关/死代码消除) |

### 1.2 目录结构

```
src/
├── entrypoints/        # 入口点 (cli.tsx, sdk/, mcp.ts)
├── screens/            # 主界面 (REPL.tsx, Doctor.tsx)
├── query.ts            # ★ 核心查询循环
├── Tool.ts             # ★ Tool 接口定义
├── tools.ts            # ★ Tool 注册表
├── tools/              # 所有内置 Tool 实现
│   ├── AgentTool/      #   子代理工具
│   ├── BashTool/       #   Shell 执行
│   ├── FileReadTool/   #   文件读取
│   ├── FileEditTool/   #   文件编辑
│   ├── FileWriteTool/  #   文件写入
│   ├── GlobTool/       #   文件搜索
│   ├── GrepTool/       #   内容搜索
│   ├── WebFetchTool/   #   网页抓取
│   ├── WebSearchTool/  #   网页搜索
│   ├── SkillTool/      #   技能/插件系统
│   ├── MCPTool/        #   MCP 外部工具
│   ├── TaskCreateTool/ #   任务管理
│   └── ...             #   30+ 其他工具
├── services/
│   ├── api/            # API 调用层 (claude.ts 核心)
│   ├── mcp/            # MCP 服务管理
│   ├── tools/          # 工具编排 (toolOrchestration.ts)
│   ├── compact/        # 上下文压缩
│   ├── analytics/      # 数据分析
│   └── ...
├── hooks/              # React hooks (权限、输入、状态管理)
├── components/         # UI 组件 (权限对话框、消息渲染)
├── constants/          # 常量 (prompts.ts System Prompt)
├── context.ts          # 上下文构建 (git status, CLAUDE.md)
├── commands.ts         # 斜杠命令注册
├── commands/           # /help, /model, /compact 等命令实现
├── state/              # 应用状态管理
├── types/              # TypeScript 类型定义
├── utils/              # 工具函数
│   ├── permissions/    #   权限系统
│   ├── model/          #   模型管理
│   ├── hooks/          #   Hook 系统
│   ├── mcp/            #   MCP 工具
│   ├── messages/       #   消息处理
│   └── ...
├── tasks/              # 后台任务 (Agent, Shell, Remote)
├── skills/             # 技能/插件系统
├── plugins/            # 插件系统
└── ink/                # Ink TUI 框架扩展
```

---

## 二、核心架构图

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                          │
│                  src/entrypoints/cli.tsx                         │
│         (参数解析 → 初始化 → 选择运行模式)                         │
└─────────────┬───────────────┬───────────────┬───────────────────┘
              │               │               │
              ▼               ▼               ▼
      ┌───────────┐   ┌─────────────┐  ┌──────────────┐
      │ REPL Mode │   │ Print Mode  │  │  SDK Mode    │
      │(交互式CLI)│   │ (单次执行)  │  │ (编程接口)   │
      └─────┬─────┘   └──────┬──────┘  └──────┬───────┘
            │                │                 │
            └────────────────┼─────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Query Loop (核心循环)                        │
│                       src/query.ts                              │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐         │
│  │ 构建上下文│───▶│ 调用 Claude  │───▶│ 流式解析响应  │         │
│  │ + Prompt │    │    API       │    │ + 工具调用    │         │
│  └──────────┘    └──────────────┘    └───────┬───────┘         │
│       ▲                                      │                  │
│       │          ┌──────────────┐            │                  │
│       │          │ Auto Compact │◀───────────┤                  │
│       │          │ (上下文压缩) │            │                  │
│       │          └──────────────┘            ▼                  │
│       │                            ┌─────────────────┐         │
│       │                            │  Tool Execution  │         │
│       │                            │  (工具编排执行)  │         │
│       │                            └────────┬────────┘         │
│       │                                     │                   │
│       └─────────────────────────────────────┘                   │
│              (有 tool_use → 递归; 无 → 结束)                     │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Tool System (工具系统)                       │
│                                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ │
│  │  Bash   │ │ Read    │ │ Edit    │ │  Agent   │ │  MCP    │ │
│  │  Tool   │ │ Tool    │ │ Tool    │ │  Tool    │ │  Tools  │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘ └────┬────┘ │
│       │           │           │           │            │       │
│       ▼           ▼           ▼           ▼            ▼       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Permission System (权限系统)                    │  │
│  │   validateInput → checkPermissions → canUseTool → call   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 消息流转架构

```
┌────────────┐     ┌──────────────────────┐     ┌────────────────┐
│   User     │────▶│   Message Queue      │────▶│  System Prompt │
│   Input    │     │   + Attachments       │     │  + User Context│
└────────────┘     └──────────────────────┘     └───────┬────────┘
                                                        │
                          ┌─────────────────────────────┘
                          ▼
              ┌──────────────────────┐
              │   Claude API Call    │
              │  (Streaming Response)│
              └──────────┬───────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │  Text    │ │ Thinking │ │ Tool Use │
      │  Block   │ │  Block   │ │  Block   │
      └────┬─────┘ └──────────┘ └────┬─────┘
           │                         │
           ▼                         ▼
      ┌──────────┐           ┌──────────────┐
      │ 渲染输出  │           │ 权限检查     │
      │ (Ink/UI) │           │ → 执行工具   │
      └──────────┘           │ → tool_result│
                             └──────┬───────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │ 追加到消息列表│
                             │ → 下一轮循环  │
                             └──────────────┘
```

---

## 三、启动链路

### 3.1 入口流程

```
cli-bootstrap.ts          # 1. 设置全局 MACRO、Feature Flags
  └─▶ cli-wrapper.ts      # 2. 加载配置、显示 banner
       └─▶ entrypoints/cli.tsx  # 3. 真正的 CLI 入口
            │
            ├─ --version → 打印版本号，退出
            ├─ --print / -p → Print Mode (非交互)
            ├─ mcp 子命令 → MCP Server 模式
            └─ 默认 → REPL Mode (交互式)
```

### 3.2 关键初始化步骤

`entrypoints/cli.tsx` → `entrypoints/init.ts`:

1. **环境检测** — 检查 Node/Bun 版本、平台
2. **配置加载** — 从 `~/.claude/settings.json` 读取设置
3. **认证验证** — 检查 API Key / OAuth Token
4. **Feature Flags** — 通过 `bun:bundle` 的 `feature()` 函数控制特性开关
5. **MCP 连接** — 异步连接配置的 MCP 服务器
6. **渲染 REPL** — 使用 Ink 渲染 `screens/REPL.tsx`

### 3.3 REPL.tsx 核心职责

`src/screens/REPL.tsx` 是整个应用的主界面组件（约 2000+ 行），职责：

- 管理会话状态（消息列表、工具权限、MCP 连接）
- 处理用户输入（文本、快捷键、斜杠命令）
- 调用 `query()` 发起 AI 对话
- 渲染消息流、权限对话框、Spinner
- 管理后台任务和子代理

---

## 四、核心循环 — Query Loop

> **文件**: `src/query.ts` — 这是 Claude Code 最核心的文件

### 4.1 函数签名

```typescript
export async function* query(params: QueryParams): AsyncGenerator<
  StreamEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal  // { reason: 'completed' | 'aborted_streaming' | ... }
>
```

**核心设计**: 使用 **AsyncGenerator** 模式，通过 `yield` 逐步输出流式事件，调用方（REPL/SDK）通过 `for await...of` 消费。

### 4.2 每轮循环的完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                    While(true) Loop                          │
│                                                              │
│  1. 构建消息列表                                              │
│     ├── getMessagesAfterCompactBoundary() — 获取压缩后消息     │
│     ├── applyToolResultBudget() — 控制工具结果大小             │
│     ├── snipCompactIfNeeded() — 历史记录裁剪                  │
│     └── microcompact() — 微压缩(移除冗余)                     │
│                                                              │
│  2. 自动压缩检查                                              │
│     └── autocompact() — Token 超限时自动摘要压缩              │
│                                                              │
│  3. 调用 Claude API                                          │
│     ├── deps.callModel() → claude.ts                         │
│     ├── 流式接收 assistant message                            │
│     ├── 提取 tool_use blocks                                 │
│     └── StreamingToolExecutor 并行启动工具                    │
│                                                              │
│  4. 工具执行                                                  │
│     ├── runTools() — 编排工具执行                             │
│     │   ├── 并发安全工具 → runToolsConcurrently()             │
│     │   └── 非并发安全 → runToolsSerially()                  │
│     ├── 权限检查 canUseTool()                                 │
│     └── 收集 tool_result                                     │
│                                                              │
│  5. 后处理                                                    │
│     ├── 处理中断 (abort signal)                               │
│     ├── 处理 max_output_tokens 恢复                           │
│     ├── 处理 prompt_too_long 恢复 (reactive compact)          │
│     ├── Stop Hooks 执行                                       │
│     ├── 获取附件消息 (memory, skill discovery)                │
│     └── 检查 maxTurns 限制                                   │
│                                                              │
│  6. 判断是否继续                                              │
│     ├── needsFollowUp=true (有 tool_use) → continue          │
│     └── needsFollowUp=false → return { reason: 'completed' } │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 关键状态管理

```typescript
type State = {
  messages: Message[]                    // 完整消息历史
  toolUseContext: ToolUseContext          // 工具执行上下文
  autoCompactTracking: AutoCompactTrackingState  // 压缩跟踪
  maxOutputTokensRecoveryCount: number   // 输出截断恢复计数
  hasAttemptedReactiveCompact: boolean   // 响应式压缩标记
  turnCount: number                      // 当前轮次
  transition: Continue | undefined       // 状态转换原因
}
```

### 4.4 错误恢复机制

Query Loop 内建多种错误恢复策略：

| 错误类型 | 恢复策略 |
|---------|---------|
| `prompt_too_long` | Context Collapse → Reactive Compact → 报错 |
| `max_output_tokens` | 先尝试升级 token 限制 → 注入恢复消息重试(最多3次) → 报错 |
| `model_fallback` | 自动切换到 fallback model 重试 |
| `image_error` | 通过 reactive compact 剥离大图重试 |

---

## 五、Tool 系统

### 5.1 Tool 接口定义 (`src/Tool.ts`)

```typescript
export type Tool<Input, Output, Progress> = {
  name: string
  aliases?: string[]             // 别名(向后兼容)
  inputSchema: ZodSchema         // Zod 输入校验
  maxResultSizeChars: number     // 结果最大字符数

  // ★ 核心方法
  call(args, context, canUseTool, parentMessage, onProgress): Promise<ToolResult>
  prompt(options): Promise<string>         // 生成 tool description
  description(input, options): Promise<string>  // 人类可读描述

  // ★ 权限与安全
  validateInput?(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionResult>
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  isConcurrencySafe(input): boolean

  // ★ UI 渲染
  renderToolUseMessage(input, options): React.ReactNode
  renderToolResultMessage?(output, progress, options): React.ReactNode
  renderToolUseProgressMessage?(progress, options): React.ReactNode
  userFacingName(input): string

  // ★ 结果映射
  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
}
```

### 5.2 工具构建模式

所有工具通过 `buildTool()` 函数构建，提供安全默认值：

```typescript
export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    // 默认值 (fail-closed)
    isEnabled: () => true,
    isConcurrencySafe: () => false,    // 默认不安全
    isReadOnly: () => false,           // 默认写操作
    isDestructive: () => false,
    checkPermissions: (input) => Promise.resolve({ behavior: 'allow', updatedInput: input }),
    userFacingName: () => def.name,
    // 覆盖
    ...def,
  }
}
```

### 5.3 工具注册 (`src/tools.ts`)

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool,          // 子代理
    TaskOutputTool,     // 任务输出
    BashTool,           // Shell 执行
    GlobTool,           // 文件搜索
    GrepTool,           // 内容搜索
    ExitPlanModeV2Tool, // 退出计划模式
    FileReadTool,       // 文件读取
    FileEditTool,       // 文件编辑
    FileWriteTool,      // 文件写入
    NotebookEditTool,   // Jupyter 编辑
    WebFetchTool,       // 网页抓取
    TodoWriteTool,      // TODO 管理
    WebSearchTool,      // 网页搜索
    TaskStopTool,       // 停止任务
    AskUserQuestionTool,// 询问用户
    SkillTool,          // 技能执行
    EnterPlanModeTool,  // 进入计划模式
    SendMessageTool,    // 发送消息
    // ... 条件加载的工具 (Feature Flags)
    // TaskCreate/Get/Update/List, Worktree, Team, Cron 等
  ]
}
```

工具池组装流程：

```
getAllBaseTools()                    # 获取所有内置工具
  → filterToolsByDenyRules()        # 过滤被拒绝的工具
  → filter by isEnabled()           # 过滤禁用的工具
  → assembleToolPool()              # 合并 MCP 工具
  → uniqBy('name')                  # 去重(内置优先)
```

### 5.4 工具编排执行 (`src/services/tools/toolOrchestration.ts`)

```typescript
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  // 1. 将工具调用分区: 并发安全 vs 非并发安全
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(...)) {
    if (isConcurrencySafe) {
      // ★ 只读工具并发执行 (Glob, Grep, Read 等)
      yield* runToolsConcurrently(blocks, ...)
    } else {
      // ★ 写操作串行执行 (Edit, Write, Bash 等)
      yield* runToolsSerially(blocks, ...)
    }
  }
}
```

**流式工具执行** (`StreamingToolExecutor`): 在 API 流式响应过程中，每当完整解析出一个 `tool_use` block，立即开始执行，不等待整个响应结束。

### 5.5 单个工具的执行流程

```
收到 tool_use block
    │
    ▼
findToolByName()          # 按名称或别名查找工具
    │
    ▼
validateInput()           # 输入校验 (Zod schema)
    │
    ▼
checkPermissions()        # 工具级权限检查
    │
    ▼
canUseTool()              # 全局权限检查
    │                     # (配置规则 → 分类器 → 用户确认)
    ├── allow → tool.call()  # 执行工具
    ├── deny  → 返回错误
    └── ask   → 弹出权限对话框
                │
                ├── 用户允许 → tool.call()
                └── 用户拒绝 → 返回拒绝消息
```

---

## 六、多 Agent 系统（4 种模式详解）

### 6.0 核心原则：Agent 不是自动触发的

**配置了多个 Agent 定义不会自动触发多 Agent 模式。** Agent 定义只是被注入到 System Prompt 的工具描述中，模型根据任务复杂度**自主决定**是否调用 `Agent` 工具。模型完全可能在整个会话中一次都不调用。

触发的本质是：模型在响应中生成了 `tool_use: Agent` block。

```
用户消息 → 模型思考
               │
               ├── 简单任务 → 直接执行工具 (Bash/Read/Edit)
               │               (不触发任何 Agent)
               │
               └── 复杂任务 → 模型自主决定 → Agent tool_use
                                                │
                    ┌───────────────────────────┼──────────────────┐
                    ▼                           ▼                  ▼
            有 subagent_type?          省略 type?          有 team+name?
            (Explore/Plan/...)      (Fork gate on?)      (Swarm gate on?)
                    │                      │                     │
                    ▼                      ▼                     ▼
              模式1: SubAgent        模式3: Fork           模式4: Swarm
              (或 模式2 Coordinator)  (继承上下文)          (独立进程)
```

### 6.1 模式 1: 普通 SubAgent（默认模式，始终可用）

#### 触发条件

| 条件 | 要求 |
|------|------|
| Feature Flag | 无需任何 flag，**默认就有** |
| 环境变量 | 无需任何配置 |
| 触发方式 | **模型自主决定**调用 `Agent` 工具并指定 `subagent_type` |
| 执行方式 | 同步阻塞（默认）或异步后台（`run_in_background: true`） |

#### 架构

```
┌─────────────────────────────────┐
│        Main Thread              │
│   (REPL query loop)            │
│                                 │
│   tool_use: Agent              │
│   ├── subagent_type: "Explore" │  ← 模型自主选择
│   ├── prompt: "search code"    │
│   └── description: "xxx"       │
│                                 │
└────────────┬────────────────────┘
             │ AgentTool.call()
             ▼
┌─────────────────────────────────┐
│      runAgent()                 │
│  src/tools/AgentTool/runAgent.ts│
│                                 │
│  1. createSubagentContext()     │  ← 创建隔离上下文
│  2. 加载 Agent 定义             │  ← 查找 Explore/Plan/自定义
│  3. 构建独立 System Prompt      │  ← 子代理独立 prompt
│  4. 过滤工具集 (限制范围)       │  ← 移除 EnterPlanMode 等
│  5. query() — 独立查询循环      │  ← 完整的嵌套 query loop
│  6. 汇总结果返回主线程          │
│                                 │
└─────────────────────────────────┘
```

#### 内置 Agent 类型

| 类型 | 说明 | 模型 | 文件 |
|------|------|------|------|
| `general-purpose` | 通用代理，默认选项 | inherit | `built-in/generalPurposeAgent.ts` |
| `Explore` | 只读代码探索，快速搜索 | haiku | `built-in/exploreAgent.ts` |
| `Plan` | 架构设计，方案规划 | inherit | `built-in/planAgent.ts` |
| `claude-code-guide` | Claude Code 使用指南 | inherit | `built-in/claudeCodeGuideAgent.ts` |
| `statusline-setup` | 状态栏配置 | inherit | `built-in/statuslineSetup.ts` |
| 自定义 | 用户在 `.claude/agents/` 定义 | 可配置 | `loadAgentsDir.ts` |

#### 自定义 Agent 配置

在 `.claude/agents/` 目录下创建 Markdown 文件：

```markdown
<!-- .claude/agents/test-runner.md -->
---
description: "Run tests after code changes"
tools:
  - Bash
  - Read
  - Glob
  - Grep
model: haiku
maxTurns: 10
---

You are a test runner agent. Run the relevant tests for the code
that was just changed and report the results.
```

或 JSON 格式：

```json
// .claude/agents/test-runner.json
{
  "description": "Run tests after code changes",
  "tools": ["Bash", "Read", "Glob", "Grep"],
  "disallowedTools": ["FileEdit", "FileWrite"],
  "model": "haiku",
  "maxTurns": 10,
  "prompt": "You are a test runner agent..."
}
```

Agent 定义的完整 schema（`src/tools/AgentTool/loadAgentsDir.ts:73`）：

```typescript
{
  description: string      // 必填，agent 描述（注入到 System Prompt）
  prompt: string           // 必填，agent 的 system prompt
  tools?: string[]         // 允许使用的工具白名单
  disallowedTools?: string[] // 禁止使用的工具黑名单
  model?: string           // 模型 ("haiku" | "sonnet" | "opus" | "inherit")
  effort?: string | number // 推理 effort 级别
  permissionMode?: string  // "default" | "plan" | "bypassPermissions"
  maxTurns?: number        // 最大轮次
  mcpServers?: array       // 需要的 MCP 服务器
  hooks?: object           // Agent 专属 hooks
  skills?: string[]        // 可用 skills
  memory?: string          // 记忆范围 "user" | "project" | "local"
  background?: boolean     // 是否强制后台运行
  isolation?: string       // "worktree" | "remote"
}
```

#### 触发案例

**案例 1**: 用户要求搜索代码 → 模型自主选择 Explore agent

```
用户: "帮我找到所有处理 authentication 的文件"

模型思考: 这是代码探索任务，适合用 Explore agent
模型输出:
  tool_use: Agent
  input: {
    subagent_type: "Explore",
    description: "Search auth files",
    prompt: "Find all files related to authentication..."
  }
```

**案例 2**: 模型并行启动多个子代理

```
用户: "这个 PR 的改动是否安全？需要加测试吗？"

模型输出 (单条消息中多个 tool_use):
  tool_use: Agent  → { subagent_type: "Explore", prompt: "分析 PR 改动范围..." }
  tool_use: Agent  → { subagent_type: "Explore", prompt: "检查测试覆盖情况..." }
```

**案例 3**: 后台运行

```
模型输出:
  tool_use: Agent
  input: {
    subagent_type: "general-purpose",
    description: "Run full test suite",
    prompt: "Run all tests and report failures...",
    run_in_background: true    ← 不阻塞主线程
  }
```

### 6.2 模式 2: Coordinator 模式（需手动开启）

#### 触发条件

| 条件 | 要求 |
|------|------|
| Feature Flag | `COORDINATOR_MODE=true`（编译时） |
| 环境变量 | **`CLAUDE_CODE_COORDINATOR_MODE=1`**（运行时必须设置） |
| 触发方式 | 开启后**自动生效**，主线程变为协调者角色 |
| 执行方式 | 主线程只做调度，所有实际工作由 worker 异步执行 |

#### 判断逻辑 (`src/coordinator/coordinatorMode.ts:36`)

```typescript
export function isCoordinatorMode(): boolean {
  if (feature('COORDINATOR_MODE')) {          // 编译时 flag
    return isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)  // 运行时 env
  }
  return false
}
```

#### 架构

```
┌────────────────────────────────────────────────────────────┐
│                  Coordinator (主线程)                        │
│                                                             │
│  可用工具: Agent, SendMessage, TaskStop (仅此3个!)          │
│  System Prompt: getCoordinatorSystemPrompt()                │
│                                                             │
│  职责:                                                      │
│  1. 理解用户需求                                            │
│  2. 分解任务 → 分派给 workers                               │
│  3. 接收 <task-notification> → 综合结果                     │
│  4. 向用户汇报                                              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Agent()  │  │ Agent()  │  │ Agent()  │  ← 并行分派       │
│  │ worker-1 │  │ worker-2 │  │ worker-3 │                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │              │              │                        │
│       ▼              ▼              ▼                        │
│  ┌──────────────────────────────────────────┐               │
│  │    异步执行 (各自独立的 query loop)        │               │
│  │    完成后: <task-notification> 通知协调者  │               │
│  └──────────────────────────────────────────┘               │
│       │              │              │                        │
│       ▼              ▼              ▼                        │
│  Coordinator 收到通知 → 综合 → SendMessage 继续/汇报用户    │
└────────────────────────────────────────────────────────────┘
```

#### 主线程工具限制

Coordinator 模式下主线程**只能使用**：

```typescript
// src/coordinator/coordinatorMode.ts
COORDINATOR_MODE_ALLOWED_TOOLS = [
  'Agent',         // 创建 worker
  'SendMessage',   // 向 worker 发送后续指令
  'TaskStop',      // 停止 worker
]
// 不能直接 Bash/Read/Edit! 必须通过 worker 执行
```

Worker 可使用的工具：

```typescript
ASYNC_AGENT_ALLOWED_TOOLS = [
  'Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill', ...
]
```

#### 配置方式

```bash
# 方式 1: 环境变量启动
CLAUDE_CODE_COORDINATOR_MODE=1 claude

# 方式 2: 在 settings.json 中配置 (需要编译时 flag 支持)
# 注意: 当前开源版本中 COORDINATOR_MODE feature flag 默认为 false
```

#### 典型交互流程

```
用户: "修复 auth 模块的空指针 bug"

Coordinator:
  让我先调查问题。
  Agent({ subagent_type: "worker", prompt: "调查 src/auth/ 中的空指针..." })
  Agent({ subagent_type: "worker", prompt: "查找 auth 相关测试文件..." })
  正在并行调查，稍后汇报。

[worker-1 完成] → <task-notification> 发现 validate.ts:42 空指针

Coordinator:
  找到了 bug — validate.ts:42 行空指针。
  SendMessage({ to: "worker-1", message: "修复 validate.ts:42 的空指针..." })
  修复进行中。

[worker-1 完成修复] → <task-notification> 已提交 commit abc123

Coordinator:
  已修复并提交 (abc123)。让我验证一下。
  Agent({ subagent_type: "worker", prompt: "运行 auth 相关测试验证修复..." })

[worker-3 完成] → <task-notification> 所有测试通过

Coordinator:
  验证完成，所有测试通过。修复已在 commit abc123 中。
```

### 6.3 模式 3: Fork SubAgent（实验性特性）

#### 触发条件

| 条件 | 要求 |
|------|------|
| Feature Flag | `FORK_SUBAGENT=true`（编译时） |
| 前置条件 | **非** Coordinator 模式 + **交互式**会话 |
| 触发方式 | 模型调用 `Agent` 工具时**省略** `subagent_type` 参数 |
| 执行方式 | 异步后台，通过 `<task-notification>` 通知 |

#### 判断逻辑 (`src/tools/AgentTool/forkSubagent.ts:32`)

```typescript
export function isForkSubagentEnabled(): boolean {
  if (feature('FORK_SUBAGENT')) {
    if (isCoordinatorMode()) return false    // 与 Coordinator 互斥
    if (getIsNonInteractiveSession()) return false  // 必须交互式
    return true
  }
  return false
}
```

#### Fork vs 普通 SubAgent 的核心区别

```
┌─────────────────────────────────────────────────────────┐
│              普通 SubAgent                               │
│                                                          │
│  父线程: "搜索 auth 相关文件"                            │
│     │                                                    │
│     └──▶ 子代理: 全新上下文 (空白)                        │
│          ├── 全新 System Prompt                          │
│          ├── 只有 prompt 参数中的信息                     │
│          └── 无法访问父线程的对话历史                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Fork SubAgent                               │
│                                                          │
│  父线程: "搜索 auth 相关文件"                            │
│     │                                                    │
│     └──▶ Fork: 继承父线程的完整上下文!                    │
│          ├── 相同的 System Prompt (字节级一致)            │
│          ├── 完整的对话历史                               │
│          ├── 共享 prompt cache (省 token 费用)           │
│          └── prompt 是一个"指令"，不需要重复背景          │
└─────────────────────────────────────────────────────────┘
```

#### 触发案例

```
# Fork 触发 — 省略 subagent_type
用户: "这个分支还有什么没完成的？"

模型输出:
  tool_use: Agent
  input: {
    name: "ship-audit",           ← 有 name (可被 SendMessage 引用)
    description: "Branch audit",
    prompt: "审计当前分支的发布就绪状态..."
    // 注意: 没有 subagent_type!  ← 这就是 Fork 的触发方式
  }

# 普通 SubAgent 触发 — 指定 subagent_type
  tool_use: Agent
  input: {
    subagent_type: "Explore",     ← 有 subagent_type → 普通 SubAgent
    description: "Search files",
    prompt: "..."
  }
```

#### 配置方式

```bash
# Fork 模式由编译时 Feature Flag 控制
# 在 cli-bootstrap.ts 的 featureFlags 中:
featureFlags['FORK_SUBAGENT'] = true   # 默认为 false

# 或通过环境变量覆盖:
CLAUDE_CODE_FEATURE_FORK_SUBAGENT=1 claude
```

#### Fork 的安全限制

- **不能递归 Fork** — 检测到已在 Fork 内会报错
- **不能在 Coordinator 模式下 Fork** — 互斥
- **不能在非交互模式下 Fork** — SDK/print 模式不支持

### 6.4 模式 4: Agent Swarm / Teammate（需特定开关）

#### 触发条件

| 条件 | 要求 |
|------|------|
| 环境变量 | **`ENABLE_AGENT_SWARMS=true`** |
| 触发方式 | 模型调用 `Agent` 工具时**同时传入** `team_name` + `name` |
| 执行方式 | 通过 **tmux** 或 **in-process** 创建独立的 teammate 进程 |
| 通信方式 | `SendMessage` 工具 + 文件系统 mailbox |

#### 判断逻辑 (`src/utils/agentSwarmsEnabled.ts`)

```typescript
export function isAgentSwarmsEnabled(): boolean {
  return isEnvTruthy(process.env.ENABLE_AGENT_SWARMS)
}
```

#### 架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Team Leader                            │
│                    (主 Claude Code 进程)                       │
│                                                               │
│  Agent({                                                      │
│    name: "reviewer",         ← 有 name                       │
│    team_name: "my-team",     ← 有 team_name → 触发 Swarm     │
│    subagent_type: "code-reviewer",                            │
│    prompt: "Review the PR..."                                 │
│  })                                                           │
│                                                               │
└───────────┬──────────────────┬──────────────────┬────────────┘
            │                  │                  │
            ▼                  ▼                  ▼
   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
   │  Teammate:      │ │  Teammate:      │ │  Teammate:      │
   │  "reviewer"     │ │  "implementer"  │ │  "tester"       │
   │                 │ │                 │ │                 │
   │  独立 Claude    │ │  独立 Claude    │ │  独立 Claude    │
   │  Code 进程      │ │  Code 进程      │ │  Code 进程      │
   │  (tmux pane)    │ │  (tmux pane)    │ │  (tmux pane)    │
   └─────────────────┘ └─────────────────┘ └─────────────────┘
           │                    │                   │
           └────────────────────┼───────────────────┘
                                ▼
                    ┌────────────────────┐
                    │  Team File (磁盘)  │
                    │  .claude/team.json │
                    │  成员列表 + 状态    │
                    └────────────────────┘
```

#### 两种后端

```typescript
// src/utils/swarm/backends/types.ts
type BackendType = 'tmux' | 'in-process'
```

| 后端 | 说明 | 优势 | 限制 |
|------|------|------|------|
| **tmux** | 每个 teammate 是独立 tmux pane | 可视化、真正隔离 | 需要 tmux 安装 |
| **in-process** | 在同一进程内运行 | 无需 tmux | 不能后台运行 |

#### Swarm 专属工具

Swarm 模式启用后，额外提供：

```typescript
// src/tools.ts
isAgentSwarmsEnabled() ? [
  TeamCreateTool,   // 创建团队
  TeamDeleteTool,   // 删除团队
] : []

// SendMessageTool 始终存在，但在 Swarm 中用于 teammate 间通信
```

#### 配置方式

```bash
# 启用 Agent Swarm
ENABLE_AGENT_SWARMS=true claude

# 确保 tmux 已安装 (推荐)
brew install tmux   # macOS
apt install tmux    # Linux
```

#### 触发案例

```
用户: "帮我做 code review 和写测试，同时进行"

模型输出 (单条消息，两个 tool_use):

  tool_use: Agent
  input: {
    name: "reviewer",              ← 有 name
    team_name: "pr-review-team",   ← 有 team_name → 触发 Swarm!
    subagent_type: "code-reviewer",
    prompt: "Review all changes on this branch..."
  }

  tool_use: Agent
  input: {
    name: "test-writer",           ← 有 name
    team_name: "pr-review-team",   ← 同一个 team
    subagent_type: "general-purpose",
    prompt: "Write tests for the new auth module..."
  }
```

此时 tmux 中会出现两个新 pane，各自运行独立的 Claude Code 实例。

#### Teammate 的限制

```typescript
// AgentTool.tsx:273 — 嵌套限制
if (isTeammate() && teamName && name) {
  throw new Error('Teammates cannot spawn other teammates')
}

// AgentTool.tsx:278 — in-process 不支持后台
if (isInProcessTeammate() && run_in_background === true) {
  throw new Error('In-process teammates cannot spawn background agents')
}
```

### 6.5 四种模式对比总结

```
┌────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│            │ 模式1:       │ 模式2:       │ 模式3:       │ 模式4:       │
│            │ SubAgent     │ Coordinator  │ Fork         │ Swarm        │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 默认可用   │ ✅ 是        │ ❌ 否        │ ❌ 否        │ ❌ 否        │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 开启方式   │ 无需配置     │ env +        │ feature flag │ env          │
│            │              │ feature flag │              │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 触发方式   │ 模型指定     │ 自动(模式    │ 模型省略     │ 模型传入     │
│            │ subagent_type│ 切换后所有   │ subagent_type│ team_name    │
│            │              │ 任务走worker)│              │ + name       │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 上下文继承 │ ❌ 全新      │ ❌ 全新      │ ✅ 完整继承  │ ❌ 全新      │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 执行方式   │ 同步/异步    │ 全部异步     │ 异步         │ 独立进程     │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 进程模型   │ 同进程       │ 同进程       │ 同进程       │ 独立进程     │
│            │              │              │              │ (tmux pane)  │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 主线程可   │ 所有工具     │ 仅 Agent/    │ 所有工具     │ 所有工具     │
│ 用工具     │              │ SendMessage/ │              │ + TeamCreate │
│            │              │ TaskStop     │              │ + TeamDelete │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ Cache 共享 │ ❌           │ ❌           │ ✅ 共享      │ ❌           │
│            │              │              │ prompt cache │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 互斥关系   │ 无           │ 与 Fork 互斥 │ 与 Coord    │ 无           │
│            │              │              │ 互斥         │              │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ 适用场景   │ 搜索、研究、 │ 大型工程任务 │ 不需要中间   │ 多人协作     │
│            │ 独立子任务   │ 多步骤编排   │ 结果的调查   │ 可视化团队   │
└────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

### 6.6 完整配置参考

```bash
# ============================================
# 模式 1: SubAgent (默认，无需任何配置)
# ============================================
claude
# 模型会自动在需要时调用 Agent 工具

# ============================================
# 模式 2: Coordinator
# ============================================
# 需要编译时支持 + 运行时环境变量
CLAUDE_CODE_COORDINATOR_MODE=1 claude
# 或 feature flag 覆盖:
CLAUDE_CODE_FEATURE_COORDINATOR_MODE=1 CLAUDE_CODE_COORDINATOR_MODE=1 claude

# ============================================
# 模式 3: Fork SubAgent
# ============================================
# 需要编译时 feature flag
CLAUDE_CODE_FEATURE_FORK_SUBAGENT=1 claude

# ============================================
# 模式 4: Agent Swarm
# ============================================
ENABLE_AGENT_SWARMS=true claude
# 推荐配合 tmux:
tmux new-session -s claude
ENABLE_AGENT_SWARMS=true claude

# ============================================
# 组合使用 (模式1 + 模式4，模式2和3互斥)
# ============================================
ENABLE_AGENT_SWARMS=true claude  # SubAgent + Swarm 同时可用
```

### 6.7 SubAgent 上下文隔离

所有模式（除 Fork 外）的子代理都经过上下文隔离：

```typescript
// src/utils/forkedAgent.ts
export function createSubagentContext(
  parentContext: ToolUseContext,
  agentId: AgentId,
): ToolUseContext {
  return {
    ...parentContext,
    agentId,
    // ★ 独立的 abort controller
    abortController: new AbortController(),
    // ★ 独立的文件状态缓存
    readFileState: cloneFileStateCache(parentContext.readFileState),
    // ★ setAppState 为 no-op (隔离状态)
    setAppState: () => {},
    // ★ 共享 setAppStateForTasks (后台任务注册)
    setAppStateForTasks: parentContext.setAppStateForTasks,
  }
}
```

### 6.8 工具限制

子代理的工具集被严格限制：

```typescript
// src/constants/tools.ts
ALL_AGENT_DISALLOWED_TOOLS = [
  'EnterPlanMode', 'ExitPlanMode',  // 不能进入计划模式
  'EnterWorktree', 'ExitWorktree',  // 不能操作 worktree
  'AskUserQuestion',                 // 不能直接问用户
  // ...
]

CUSTOM_AGENT_DISALLOWED_TOOLS = [
  'Agent',         // 自定义 agent 不能再创建 agent
  'TodoWrite',     // 不能写 TODO
  // ...
]
```

---

## 七、MCP (Model Context Protocol) 系统

### 7.1 架构

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  Claude Code │────▶│  MCP Client       │────▶│ MCP Server   │
│  (Host)      │     │  (JSON-RPC/stdio) │     │ (外部进程)   │
└──────────────┘     └───────────────────┘     └──────────────┘
                                                      │
                          ┌───────────────────────────┘
                          ▼
                    提供: Tools, Resources, Prompts
```

### 7.2 核心文件

| 文件 | 职责 |
|------|------|
| `services/mcp/client.ts` | MCP 客户端连接管理 |
| `services/mcp/config.ts` | MCP 服务器配置解析 |
| `services/mcp/types.ts` | MCP 类型定义 |
| `services/mcp/normalization.ts` | 工具名称规范化 |
| `services/mcp/MCPConnectionManager.tsx` | React 连接管理器 |
| `tools/MCPTool/` | MCP 工具桥接 |

### 7.3 MCP 工具注册流程

```
1. 读取配置 (~/.claude/settings.json → mcpServers)
2. 异步连接每个 MCP Server (stdio/SSE)
3. 获取 server.listTools() → 工具列表
4. 规范化工具名: mcp__{serverName}__{toolName}
5. 创建 Tool 实例 (MCPTool wrapper)
6. 合并到全局工具池 assembleToolPool()
7. 下一轮 query 时模型即可使用
```

### 7.4 配置示例

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

---

## 八、Hook / Permission 系统

### 8.1 权限模式

```typescript
type PermissionMode = 'default' | 'plan' | 'bypassPermissions'
```

| 模式 | 行为 |
|------|------|
| `default` | 每次工具调用检查权限规则，不匹配则询问用户 |
| `plan` | 只允许只读操作，写操作需确认 |
| `bypassPermissions` | 跳过权限检查，直接执行 |

### 8.2 权限检查链路

```
┌──────────────────────────────────────────────────────────┐
│              canUseTool() 权限检查链路                     │
│                                                          │
│  1. tool.validateInput()     # 工具级输入校验             │
│     └── 失败 → 返回错误消息给模型                         │
│                                                          │
│  2. hasPermissionsToUseTool()  # 全局权限检查             │
│     ├── alwaysAllowRules 匹配  → allow                   │
│     ├── alwaysDenyRules 匹配   → deny                    │
│     ├── isReadOnly + default   → allow                   │
│     ├── Classifier (自动模式)  → allow/deny              │
│     └── 其他                   → ask (需用户确认)         │
│                                                          │
│  3. 用户确认 (ask 情况)                                   │
│     ├── Allow           → 执行                           │
│     ├── Allow Always    → 添加到 alwaysAllowRules        │
│     ├── Deny            → 返回拒绝                       │
│     └── Deny Always     → 添加到 alwaysDenyRules         │
└──────────────────────────────────────────────────────────┘
```

### 8.3 Hook 系统

Hook 是用户可配置的 shell 命令，在特定事件时执行：

```json
// settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "echo 'About to run bash'"
      }
    ],
    "PostToolUse": [...],
    "Stop": [...],         // 模型停止时
    "PreCompact": [...],   // 压缩前
    "PostCompact": [...]   // 压缩后
  }
}
```

Hook 可以返回控制指令：
- `{ "decision": "allow" }` — 允许工具执行
- `{ "decision": "deny", "reason": "..." }` — 拒绝工具执行
- `{ "decision": "block", "reason": "..." }` — 阻止并告知模型

---

## 九、上下文管理

### 9.1 System Prompt 构建 (`src/constants/prompts.ts`)

```
System Prompt 由多个 Section 组装:

┌─────────────────────────────────────────┐
│ 1. 角色定义                              │
│    "You are Claude Code, Anthropic's..." │
├─────────────────────────────────────────┤
│ 2. 工具使用指南                          │
│    每个工具的 prompt() 输出               │
├─────────────────────────────────────────┤
│ 3. 环境信息                              │
│    OS, Shell, Model, Date, CWD          │
├─────────────────────────────────────────┤
│ 4. Git 状态                              │
│    Branch, Status, Recent Commits       │
├─────────────────────────────────────────┤
│ 5. CLAUDE.md 内容                        │
│    项目级/用户级配置文件                  │
├─────────────────────────────────────────┤
│ 6. Memory 文件                           │
│    ~/.claude/projects/.../memory/        │
├─────────────────────────────────────────┤
│ 7. 输出风格指南                          │
│    Tone, formatting, efficiency          │
└─────────────────────────────────────────┘
```

### 9.2 上下文（User Context / System Context）

```typescript
// src/context.ts
getUserContext() → {
  gitStatus: string          // git branch, status, recent commits
  claudeMd: string           // CLAUDE.md 文件内容
  memoryFiles: string        // Memory 文件内容
}

getSystemContext() → {
  currentDate: string        // 当前日期
  // ... 其他动态上下文
}
```

### 9.3 自动压缩 (Auto Compact)

当上下文 token 数接近模型限制时，自动触发压缩：

```
┌─────────────────────────────────┐
│   Token Count Check             │
│   (每轮循环开头)                 │
│                                  │
│   token_count > threshold?       │
│        │                         │
│        ▼ YES                     │
│   ┌─────────────────────┐       │
│   │ Fork Agent 调用模型  │       │
│   │ 生成会话摘要         │       │
│   └──────────┬──────────┘       │
│              │                   │
│              ▼                   │
│   ┌─────────────────────┐       │
│   │ 替换历史消息为摘要   │       │
│   │ 保留最近的消息尾部   │       │
│   └─────────────────────┘       │
└─────────────────────────────────┘
```

压缩层级:
1. **Snip Compact** — 裁剪最旧的消息
2. **Microcompact** — 移除冗余元信息
3. **Auto Compact** — 用模型生成摘要替换
4. **Reactive Compact** — API 返回 413 时紧急压缩
5. **Context Collapse** — 折叠历史片段

---

## 十、UI 层

### 10.1 Ink + React 终端渲染

Claude Code 使用 **Ink** 框架（React for CLI）进行终端渲染：

```
┌─────────────────────────────────────────┐
│  Ink Application                        │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  Message List (虚拟滚动)            │ │
│  │  ├── UserMessage                    │ │
│  │  ├── AssistantMessage (Markdown)    │ │
│  │  ├── ToolUseMessage (工具调用)      │ │
│  │  ├── ToolResultMessage (结果)       │ │
│  │  └── SystemMessage (系统提示)       │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  Spinner (加载动画)                 │ │
│  │  "Reading file.ts..."               │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  Permission Dialog (权限对话框)     │ │
│  │  [Allow] [Deny] [Always Allow]      │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  PromptInput (输入框)               │ │
│  │  > _                                │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 10.2 核心 React Hooks

| Hook | 职责 |
|------|------|
| `useCanUseTool` | 权限检查与用户确认 |
| `useMergedTools` | 合并内置+MCP工具 |
| `useTerminalSize` | 终端尺寸监听 |
| `useQueueProcessor` | 消息队列处理 |
| `useAssistantHistory` | 历史会话管理 |
| `useScheduledTasks` | 定时任务管理 |
| `useVimInput` | Vim 键位支持 |
| `useSearchInput` | 搜索模式 |

---

## 十一、自建 Agent 实现参考

### 11.1 最小可行架构

从 Claude Code 源码提炼的核心 Agent 架构：

```
┌─────────────────────────────────────────────┐
│              Your Agent                      │
│                                              │
│  1. System Prompt Builder                    │
│     - 角色定义                               │
│     - 工具描述 (每个 tool.prompt())          │
│     - 环境上下文 (CWD, Git, 日期)            │
│     - CLAUDE.md / 自定义指令                 │
│                                              │
│  2. Query Loop (核心循环)                    │
│     while (true) {                           │
│       response = await callModel(messages)   │
│       if (no tool_use) break                 │
│       results = await executeTools(response) │
│       messages.push(response, ...results)    │
│     }                                        │
│                                              │
│  3. Tool System                              │
│     - Tool 接口: name, schema, call()        │
│     - 权限检查: checkPermissions()           │
│     - 并发控制: isConcurrencySafe            │
│                                              │
│  4. Context Management                       │
│     - Token 计数                             │
│     - 自动压缩 (Auto Compact)               │
│     - 消息历史管理                           │
└─────────────────────────────────────────────┘
```

### 11.2 核心模式提炼

#### 模式 1: Tool 定义模式

```typescript
// 定义一个 Tool 的最小模式
interface Tool {
  name: string
  description: string
  inputSchema: object        // JSON Schema
  call(input: any): Promise<{ data: string }>
  isReadOnly(input: any): boolean
  isConcurrencySafe(input: any): boolean
}

// 注册到工具列表
const tools: Tool[] = [readTool, editTool, bashTool, ...]

// 转换为 API 格式
function toolToAPISchema(tool: Tool) {
  return {
    name: tool.name,
    description: await tool.prompt(),
    input_schema: tool.inputSchema,
  }
}
```

#### 模式 2: AsyncGenerator Query Loop

```typescript
async function* query(messages, tools, systemPrompt) {
  while (true) {
    // 1. 调用模型
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      system: systemPrompt,
      messages: normalizeMessages(messages),
      tools: tools.map(toolToAPISchema),
      max_tokens: 16384,
    })

    // 2. yield 流式事件
    yield { type: 'assistant', message: response }

    // 3. 提取 tool_use
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    if (toolUseBlocks.length === 0) {
      return { reason: 'completed' }
    }

    // 4. 执行工具
    const toolResults = []
    for (const block of toolUseBlocks) {
      const tool = findTool(block.name)
      const result = await tool.call(block.input)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.data,
      })
      yield { type: 'tool_result', ...result }
    }

    // 5. 追加到消息继续循环
    messages = [...messages, response, { role: 'user', content: toolResults }]
  }
}
```

#### 模式 3: 并发工具执行

```typescript
async function executeTools(toolUseBlocks, tools) {
  // 分区: 只读工具可以并发，写操作必须串行
  const { concurrent, serial } = partition(toolUseBlocks, block => {
    const tool = findTool(block.name)
    return tool.isConcurrencySafe(block.input)
  })

  // 并发执行只读工具
  const concurrentResults = await Promise.all(
    concurrent.map(block => executeSingleTool(block))
  )

  // 串行执行写操作
  const serialResults = []
  for (const block of serial) {
    serialResults.push(await executeSingleTool(block))
  }

  return [...concurrentResults, ...serialResults]
}
```

#### 模式 4: 子代理 (SubAgent)

```typescript
async function runSubAgent(prompt, tools, parentContext) {
  const agentId = generateId()

  // 1. 创建隔离上下文
  const agentContext = {
    ...parentContext,
    agentId,
    abortController: new AbortController(),
    // 工具子集 (限制范围)
    tools: tools.filter(t => !DISALLOWED_TOOLS.includes(t.name)),
  }

  // 2. 构建独立 system prompt
  const systemPrompt = buildAgentSystemPrompt(agentContext)

  // 3. 运行独立 query loop
  const messages = [{ role: 'user', content: prompt }]
  for await (const event of query(messages, agentContext.tools, systemPrompt)) {
    // 收集结果...
  }

  // 4. 返回摘要
  return summarizeAgentResult(messages)
}
```

#### 模式 5: 权限系统

```typescript
async function checkPermission(tool, input, context) {
  // 1. 检查配置规则
  if (matchesAllowRule(tool, input)) return { behavior: 'allow' }
  if (matchesDenyRule(tool, input))  return { behavior: 'deny' }

  // 2. 只读操作默认允许
  if (tool.isReadOnly(input)) return { behavior: 'allow' }

  // 3. 需要用户确认
  return { behavior: 'ask' }
}
```

#### 模式 6: 上下文压缩

```typescript
async function autoCompactIfNeeded(messages, model) {
  const tokenCount = estimateTokens(messages)
  const threshold = getContextLimit(model) * 0.8

  if (tokenCount < threshold) return messages

  // 用模型生成摘要
  const summary = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    messages: [{
      role: 'user',
      content: `Summarize this conversation:\n${serializeMessages(messages)}`
    }],
  })

  // 保留最近消息 + 摘要
  const recentMessages = messages.slice(-KEEP_RECENT)
  return [
    { role: 'user', content: `Previous conversation summary:\n${summary}` },
    ...recentMessages,
  ]
}
```

### 11.3 关键设计原则

从 Claude Code 源码中提炼的设计原则：

1. **AsyncGenerator 驱动** — 用 `yield` 实现流式输出，调用方解耦
2. **Fail-Closed 安全默认** — 工具默认不并发、非只读、需权限检查
3. **分区并发** — 只读工具并发执行，写操作串行执行
4. **多层错误恢复** — prompt_too_long → compact → retry，逐级降级
5. **上下文隔离** — 子代理有独立状态，共享任务注册通道
6. **工具可组合** — 内置工具 + MCP 外部工具 统一接口
7. **渐进式权限** — 默认询问 → 用户可设置永久规则
8. **Feature Flag 驱动** — `bun:bundle` 编译时消除不需要的代码路径

---

## 十二、关键文件索引

| 文件 | 核心职责 |
|------|---------|
| `src/entrypoints/cli.tsx` | CLI 入口，参数解析，模式选择 |
| `src/screens/REPL.tsx` | 主界面组件，会话状态管理 |
| `src/query.ts` | **核心查询循环**，消息→模型→工具→递归 |
| `src/Tool.ts` | Tool 接口定义，类型系统 |
| `src/tools.ts` | 工具注册表，工具池组装 |
| `src/services/api/claude.ts` | Claude API 调用，流式处理 |
| `src/services/tools/toolOrchestration.ts` | 工具执行编排（并发/串行） |
| `src/services/tools/toolExecution.ts` | 单个工具执行逻辑 |
| `src/tools/AgentTool/runAgent.ts` | 子代理运行逻辑 |
| `src/utils/forkedAgent.ts` | 子代理上下文隔离 |
| `src/hooks/useCanUseTool.tsx` | 权限检查与用户交互 |
| `src/utils/permissions/permissions.ts` | 权限规则匹配 |
| `src/constants/prompts.ts` | System Prompt 构建 |
| `src/context.ts` | 环境上下文构建 (Git, CLAUDE.md) |
| `src/services/compact/autoCompact.ts` | 自动上下文压缩 |
| `src/services/compact/compact.ts` | 压缩实现 |
| `src/services/mcp/client.ts` | MCP 客户端连接 |
| `src/services/mcp/config.ts` | MCP 服务器配置 |
| `src/commands.ts` | 斜杠命令注册 |
| `src/state/AppState.ts` | 应用全局状态 |
| `src/cost-tracker.ts` | Token 费用追踪 |
| `src/history.ts` | 会话历史管理 |

---

## 十三、数据流总结

```
用户输入
  │
  ▼
REPL.tsx (processUserInput)
  │
  ├── /command → 斜杠命令处理
  │
  └── 普通消息 → query()
       │
       ├── [构建] System Prompt + User Context + System Context
       ├── [准备] messages (compact/snip/microcompact)
       ├── [调用] Claude API (streaming)
       │     │
       │     └── yield AssistantMessage (文本/thinking/tool_use)
       │
       ├── [执行] Tool Orchestration
       │     ├── Permission Check (canUseTool)
       │     ├── Concurrent Tools (read-only)
       │     ├── Serial Tools (write)
       │     └── yield ToolResult
       │
       ├── [附件] Memory/Skill/Notification Attachments
       │
       └── [循环] 有 tool_use → 继续; 无 → 结束
             │
             ▼
       return { reason: 'completed' }
```
