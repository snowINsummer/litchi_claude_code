# Ultraplan/Ultrareview 远程执行设计分析

> 基于 Claude Code 2.1.88 源码分析，解释为什么 Ultraplan/Ultrareview 设计为远程云端执行，以及本地多 Agent 替代方案。

---

## 一、远程执行的设计原因

### 1.1 长时间运行不阻塞本地

```
Ultraplan: ULTRAPLAN_TIMEOUT_MS = 30 * 60 * 1000  (30分钟)
Ultrareview: BUGHUNTER_FLEET_SIZE 5~20 个并行代理
```

本地执行意味着 30 分钟内终端被占用，用户无法继续工作。远程执行后，本地只做轮询（`startDetachedPoll()`），用户可以继续用 Claude Code 做其他事。

### 1.2 Fleet 并行 — 单机资源不够

Ultrareview 的 Bughunter 模式启动 **5~20 个并行 Agent**，每个都是完整的 query loop + Opus 模型调用。本地同时跑 20 个 Agent：

- **内存**：每个 Agent 维护完整消息历史，20 个并发可能吃掉几个 GB
- **API 并发**：20 路同时请求，本地网络和 rate limit 压力大
- **CCR 优势**：在服务端做请求调度，可以复用 prompt cache，显著降低成本

### 1.3 安全沙箱隔离

Ultrareview 要在代码仓库上执行探索性操作（Bash、文件读写），如果在本地运行：

- 代码执行直接操作用户文件系统，有风险
- CCR 提供 **容器化沙箱**，代码执行在隔离环境中，不影响本地

### 1.4 计费与商业模式

```typescript
// ultrareviewCommand.tsx
checkOverageGate()  // 免费额度 → Extra Usage 付费
```

远程执行让 Anthropic 可以精确计量 Opus token 消耗，控制免费额度和付费转换。本地执行无法实现这种计费闭环。

### 1.5 模型调度优化

```typescript
getUltraplanModel()  // GrowthBook 动态配置 Opus 模型
```

CCR 端可以做服务端模型路由、A/B 测试、负载均衡，甚至在 Opus 过载时降级到 Sonnet，这些本地客户端做不到。

---

## 二、本地多 Agent 能否替代？

**可以部分替代**，核心逻辑其实就是：

```
1. Ultraplan = 一个 SubAgent 用 Opus 跑 30 分钟做规划
2. Ultrareview = N 个 SubAgent 并行做 code review → 汇总
```

用本地 Coordinator 模式 + 多个 SubAgent 完全可以实现同样的逻辑：

```bash
# 本地版 Ultraplan
CLAUDE_CODE_COORDINATOR_MODE=1 claude
# 让 Coordinator 分派一个 worker 做长时间规划

# 本地版 Ultrareview  
# 自定义 Agent 定义，启动 5 个 Explore agent 并行审查
```

---

## 三、远程 vs 本地对比

| 维度 | 远程 CCR | 本地多 Agent |
|------|---------|-------------|
| 终端占用 | 不阻塞 | 阻塞（除非 tmux） |
| 并发规模 | 20+ Agent | 受本机资源限制 |
| 安全隔离 | 容器沙箱 | 直接操作本地文件 |
| Prompt Cache | 服务端共享 | 无法共享 |
| 成本 | Anthropic 承担基础设施 | 用户承担全部 API 费用 |

---

## 四、结论

远程执行是**产品化设计**（SaaS 化、可计费、可扩展），不是技术必须。对于自建场景，本地多 Agent + Docker 沙箱可以达到 80% 的效果。

**自建推荐方案**：MCP Server + Docker 容器执行，基本等价于自建版 CCR。

具体实现：

```
┌────────────────────┐      ┌────────────────────┐
│  Claude Code       │      │  MCP Server        │
│  (本地)            │─────▶│  (自建)            │
│                    │ MCP  │                    │
│  /ultraplan →      │      │  remote_plan tool  │──▶ Docker 容器
│  调用 MCP tool     │      │  remote_review tool│──▶ 多个 Agent 并行
│                    │      │  remote_execute    │──▶ 安全沙箱执行
└────────────────────┘      └────────────────────┘
```

MCP 方案的优势：
- **零修改 Claude Code** — 只需配置 MCP Server
- **安全隔离** — Docker 容器提供沙箱
- **可扩展** — 多容器并行，不受本机限制
- **灵活模型** — 每个容器内的 Agent 可以用不同模型（Opus/Gemini/GPT）

---

## 五、UDS Inbox 深度分析 — 不仅仅是跨会话通信

### 5.1 两层通信架构

UDS Inbox 系统实际上包含 **两层通信机制**，协同工作：

```
┌─────────────────────────────────────────────────────────────┐
│                    通信架构                                   │
│                                                              │
│  Layer 1: 文件邮箱 (File-Based Mailbox)                      │
│  ├── 路径: ~/.claude/teams/{team}/inboxes/{agent}.json       │
│  ├── 锁机制: proper-lockfile (10次重试, 5-100ms退避)         │
│  ├── 始终可用 (Swarm 启用时)                                  │
│  └── 用于: Teammate 间通信、权限同步                          │
│                                                              │
│  Layer 2: UDS (Unix Domain Socket)                           │
│  ├── Feature Flag: UDS_INBOX                                 │
│  ├── Socket: CLAUDE_CODE_MESSAGING_SOCKET                    │
│  ├── 需要 CLAUDE_CODE_FEATURE_UDS_INBOX=1                    │
│  └── 用于: 跨 Claude Code 实例的实时低延迟通信               │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 文件邮箱协议 — 10+ 种消息类型

邮箱消息不是简单的文本传递，而是一套 **完整的协调协议**：

```typescript
// 消息基本结构
type TeammateMessage = {
  from: string        // 发送者名称
  text: string        // 消息内容 (纯文本 或 JSON 结构化消息)
  timestamp: string   // ISO 时间戳
  read: boolean       // 已读/未读跟踪
  color?: string      // 发送者颜色 (UI 区分用)
  summary?: string    // 5-10 字预览
}
```

**完整的协议消息类型**：

| 类型 | 方向 | 用途 |
|------|------|------|
| `permission_request` | Worker → Leader | 请求工具执行权限 |
| `permission_response` | Leader → Worker | 回复权限请求 |
| `sandbox_permission_request` | Worker → Leader | 请求网络访问权限 |
| `sandbox_permission_response` | Leader → Worker | 回复网络权限 |
| `shutdown_request` | Leader → Worker | 要求 teammate 关闭 |
| `shutdown_approved` | Worker → Leader | 确认关闭 (含 tmux paneId) |
| `shutdown_rejected` | Worker → Leader | 拒绝关闭 (含原因) |
| `plan_approval_request` | Worker → Leader | 提交计划待审批 |
| `plan_approval_response` | Leader → Worker | 批准/拒绝计划 |
| `team_permission_update` | Leader → Workers | 广播权限规则变更 |
| `mode_set_request` | Leader → Worker | 修改 Worker 权限模式 |
| `idle_notification` | Worker → Leader | 通知空闲状态 |
| `task_assignment` | Leader → Worker | 分配任务 |

**关键协议消息示例**：

```typescript
// 权限请求 (Worker → Leader)
{
  type: 'permission_request',
  request_id: 'uuid-xxx',
  agent_id: 'worker-1',
  tool_name: 'Bash',
  tool_use_id: 'toolu_xxx',
  description: 'Run npm test',
  input: { command: 'npm test' },
  permission_suggestions: [...]
}

// 权限响应 (Leader → Worker)
{
  type: 'permission_response',
  request_id: 'uuid-xxx',
  subtype: 'success',  // or 'error'
  response: {
    updated_input: { ... },
    permission_updates: [...]
  }
}

// 关闭确认 (Worker → Leader, 含 tmux 清理信息)
{
  type: 'shutdown_approved',
  requestId: 'uuid-xxx',
  from: 'worker-1',
  paneId: '%5',          // tmux pane ID
  backendType: 'tmux'    // 'tmux' | 'iterm' | 'in-process'
}
```

### 5.3 消息路由 — SendMessageTool 统一入口

`SendMessageTool` 是所有 Agent 间通信的统一路由器，根据 `to` 字段自动选择通道：

```
SendMessage({ to: "xxx", message: "..." })
    │
    ├── "bridge:session-id"   → Remote Control 桥接 (跨机器, 通过 Anthropic 服务器)
    ├── "uds:/path/to/socket" → Unix Domain Socket (本地跨会话, 实时)
    ├── 进程内 Agent 名称      → 检查 agentNameRegistry + tasks, 内存队列
    ├── "*" (广播)            → 写入所有 team 成员的邮箱文件
    └── 具名 teammate         → 写入该 teammate 的邮箱文件
```

地址解析方案 (`src/utils/peerAddress.ts`)：

```typescript
"uds:/tmp/claude.sock"    → scheme: 'uds',    target: '/tmp/claude.sock'
"bridge:sess-123"         → scheme: 'bridge',  target: 'sess-123'
"/tmp/claude.sock"        → scheme: 'uds',    target: '/tmp/claude.sock'  // 裸路径兼容
"worker-1"                → scheme: 'other',   target: 'worker-1'  // 邮箱路由
```

### 5.4 轮询与消息注入

**邮箱轮询** (`useInboxPoller`)：每 **1 秒** 检查一次新消息，按类型路由：

```
每 1 秒轮询
    │
    ├── 权限请求 → 路由到 ToolUseConfirmQueue (Leader 显示权限对话框)
    ├── 权限响应 → 调用注册的回调 (Worker 继续执行)
    ├── 团队权限更新 → 应用新规则到 Worker 本地上下文
    ├── 模式设置 → 修改 Worker 权限模式
    ├── 关闭请求/响应 → 生命周期管理
    └── 普通消息 → 包装为 XML 注入到对话:
        <teammate-message teammate_id="worker-1" color="cyan" summary="Found bug">
        消息内容
        </teammate-message>
```

**权限同步轮询** (`useSwarmPermissionPoller`)：每 **500ms** 检查权限响应。

**消息注入时机**：
- 会话空闲 → 立即作为新用户消息提交
- 会话繁忙 → 队列到 `AppState.inbox`，当前轮结束后投递

### 5.5 团队文件结构

```typescript
// ~/.claude/teams/{team_name}/team.json
{
  name: string,
  leadAgentId: string,
  leadSessionId?: string,
  members: [{
    agentId: string,
    name: string,
    model?: string,
    prompt?: string,
    color?: string,            // UI 区分颜色
    tmuxPaneId: string,
    cwd: string,
    worktreePath?: string,     // Git worktree 隔离
    sessionId?: string,
    backendType?: 'tmux' | 'iterm' | 'in-process',
    isActive?: boolean,
    mode?: PermissionMode
  }]
}
```

### 5.6 UDS Inbox 的功能远不止"聊天"

总结 UDS Inbox + 文件邮箱系统的完整能力：

| 功能 | 说明 |
|------|------|
| **消息通信** | Agent 间发送文本消息 |
| **权限代理** | Worker 请求 Leader 审批工具执行 |
| **生命周期管理** | 关闭请求/确认 + tmux pane 清理 |
| **计划审批** | Worker 提交计划，Leader 审批 |
| **权限广播** | Leader 向所有 Worker 推送规则变更 |
| **模式切换** | Leader 远程修改 Worker 权限模式 |
| **空闲通知** | Worker 告知 Leader 可以接新任务 |
| **任务分配** | Leader 向空闲 Worker 分派工作 |
| **跨机器桥接** | 通过 `bridge:` 地址跨机器通信 |

---

## 六、Teleport 深度分析 — 远超"存储会话内容"

### 6.1 Teleport 完整流程

```
┌──────────────────────────────────────────────────────────────────┐
│                  Teleport: 本地 → 远程 → 回传                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Phase 1: 发送到远程 (teleportToRemote)                       │ │
│  │                                                              │ │
│  │  1. OAuth 认证 → 获取 accessToken + orgUUID                 │ │
│  │  2. Haiku 生成会话标题 + claude/<name> 分支名                │ │
│  │  3. 代码传输 (三选一):                                       │ │
│  │     ├── GitHub Clone: CCR 通过 GitHub App 直接克隆           │ │
│  │     ├── Git Bundle: 本地打包上传到 Files API                 │ │
│  │     └── 空沙箱: 无 .git 时的空目录                           │ │
│  │  4. 选择计算环境 (anthropic_cloud / byoc / bridge)           │ │
│  │  5. POST /v1/sessions 创建远程会话                           │ │
│  │     ├── 注入 permission_mode 控制事件                        │ │
│  │     ├── 注入用户消息 (任务描述)                               │ │
│  │     └── 设置 session_context (代码源+结果分支+模型)           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                             │                                     │
│                             ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Phase 2: 远程执行 (CCR 服务端)                               │ │
│  │                                                              │ │
│  │  1. 容器环境配置 (Python/Node/语言支持)                      │ │
│  │  2. 克隆代码 (GitHub 或 解压 Bundle)                         │ │
│  │  3. 应用 WIP 变更 (refs/seed/stash)                          │ │
│  │  4. 运行完整 Claude Code query loop                          │ │
│  │  5. 执行工具 (Bash/Read/Edit 在容器沙箱内)                   │ │
│  │  6. 推送代码到 outcome 分支 (claude/xxx)                     │ │
│  │  7. 所有事件存储为 WorkerEvents (可轮询)                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                             │                                     │
│                             ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Phase 3: 回传到本地 (teleportResumeCodeSession)              │ │
│  │                                                              │ │
│  │  1. 校验仓库匹配 (本地 remote 与远程 source URL)             │ │
│  │  2. 拉取对话记录:                                             │ │
│  │     ├── v2: GET /v1/code/sessions/{id}/teleport-events       │ │
│  │     └── v1: GET /v1/session_ingress/session/{id} (降级)      │ │
│  │  3. git fetch + checkout outcome 分支                         │ │
│  │  4. 消息反序列化 → 注入本地会话历史                           │ │
│  │  5. 注入"本会话从另一台机器恢复"上下文消息                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 传输的数据 — 远不止会话内容

#### 发送到远程的数据

| 数据 | 机制 | 详情 |
|------|------|------|
| **仓库代码** | GitHub Clone 或 Git Bundle | Bundle 含 `--all` refs + WIP stash (`refs/seed/stash`)，最大 100MB |
| **初始消息** | Session 创建 payload 中的 event | 用户的 prompt/任务描述 |
| **权限模式** | `control_request` event | `set_permission_mode` + ultraplan flag |
| **模型选择** | `session_context.model` | 当前 `getMainLoopModel()` |
| **分支信息** | `sources[].revision` + `outcomes[].branches[]` | 基础分支 + 结果推送分支 |
| **环境变量** | `session_context.environment_variables` | 含 `CLAUDE_CODE_OAUTH_TOKEN` |
| **PR 信息** | `session_context.github_pr` | `{ owner, repo, number }` |

#### 从远程回传的数据

| 数据 | 机制 | 详情 |
|------|------|------|
| **完整对话记录** | `GET /v1/code/sessions/{id}/teleport-events` | 用户/助手/工具调用/工具结果全部事件 |
| **代码变更** | `git fetch origin <branch>` | CCR 推送的 outcome 分支 |
| **会话状态** | `GET /v1/sessions/{id}` | `running`/`idle`/`requires_action`/`archived` |

### 6.3 CCR 的完整能力 — 6 大功能

**你的理解"只是存储会话内容以便传输"是不准确的。** CCR 实际提供 6 大功能：

```
┌─────────────────────────────────────────────────────────────┐
│                   CCR 完整功能清单                            │
│                                                              │
│  1. 容器环境管理                                             │
│     ├── 自动配置 Python 3.11 / Node 20 等语言支持            │
│     ├── 网络配置 (默认隔离，可申请外网)                       │
│     ├── init 脚本执行 (如 bughunter 的 run_hunt.sh)          │
│     └── 环境提供商选择 (anthropic_cloud / byoc)              │
│                                                              │
│  2. 代码仓库管理                                             │
│     ├── 通过 GitHub App 克隆私有仓库                         │
│     ├── 解压 Git Bundle + 应用 WIP stash                     │
│     ├── 创建并推送 outcome 分支                              │
│     └── 支持 reuse_outcome_branches (直接推送到用户分支)     │
│                                                              │
│  3. AI 执行引擎                                              │
│     ├── 运行完整 Claude Code query loop                      │
│     ├── 容器内执行 Bash/Read/Edit 等工具                     │
│     ├── 支持指定模型 (Opus/Sonnet)                           │
│     └── 多 Agent 并行 (Ultrareview bughunter fleet)          │
│                                                              │
│  4. 事件流存储与分发                                         │
│     ├── 所有模型轮次存储为 WorkerEvents                      │
│     ├── 分页 API 支持实时轮询 (after_id 游标)                │
│     ├── v2 Spanner + v1 Threadstore 双存储                   │
│     └── teleport-events API 支持完整记录回传                 │
│                                                              │
│  5. 会话生命周期管理                                         │
│     ├── 状态机: running → idle → requires_action → archived  │
│     ├── 归档 API: POST /sessions/{id}/archive                │
│     ├── TTL 自动清理过期会话                                  │
│     └── 稳定空闲检测 (5次连续 idle 确认完成)                  │
│                                                              │
│  6. 专用任务类型                                             │
│     ├── remote-agent: 通用远程代理                           │
│     ├── ultraplan: 30分钟深度规划                             │
│     ├── ultrareview: 多 Agent 代码审查                       │
│     ├── autofix-pr: PR 自动修复                              │
│     └── background-pr: 后台 PR 处理                          │
└─────────────────────────────────────────────────────────────┘
```

### 6.4 CCR API 协议完整参考

所有端点使用 `https://api.claude.ai` 作为 base URL。

| 端点 | 方法 | 用途 |
|------|------|------|
| `/v1/sessions` | POST | 创建远程会话 |
| `/v1/sessions/{id}` | GET | 获取会话状态 |
| `/v1/sessions/{id}` | PATCH | 更新会话标题 |
| `/v1/sessions/{id}/archive` | POST | 归档/停止会话 |
| `/v1/sessions/{id}/events` | POST | 发送用户消息到运行中会话 |
| `/v1/sessions/{id}/events` | GET | 分页轮询事件 (`?after_id=cursor`) |
| `/v1/sessions` | GET | 列出所有会话 |
| `/v1/code/sessions/{id}/teleport-events` | GET | 分页获取完整对话记录 |
| `/v1/session_ingress/session/{id}` | GET | 旧版一次性获取记录 |
| `/v1/environment_providers` | GET | 列出可用计算环境 |
| `/v1/environment_providers/cloud/create` | POST | 创建默认云环境 |
| `/v1/files` | POST | 上传 Git Bundle |

**通用请求头**：

```
Authorization: Bearer <oauth_access_token>
Content-Type: application/json
anthropic-version: 2023-06-01
anthropic-beta: ccr-byoc-2025-07-29
x-organization-uuid: <org_uuid>
```

**创建会话请求体**：

```json
{
  "title": "Fix auth null pointer",
  "events": [
    {
      "type": "event",
      "data": {
        "type": "control_request",
        "request": { "subtype": "set_permission_mode", "mode": "bypassPermissions" }
      }
    },
    {
      "type": "event",
      "data": {
        "type": "user",
        "message": { "role": "user", "content": "Fix the auth bug..." }
      }
    }
  ],
  "session_context": {
    "sources": [{ "type": "git_repository", "url": "https://github.com/owner/repo", "revision": "main" }],
    "outcomes": [{ "type": "git_repository", "git_info": { "type": "github", "repo": "owner/repo", "branches": ["claude/fix-auth"] } }],
    "model": "claude-sonnet-4-20250514",
    "seed_bundle_file_id": "file-xxx",
    "github_pr": { "owner": "owner", "repo": "repo", "number": 123 }
  },
  "environment_id": "env-xxx"
}
```

---

## 七、能否自建替代？— 可行性分析

### 7.1 UDS Inbox — 完全可自建

**结论：✅ 100% 可自建，无外部依赖。**

UDS Inbox 的两层机制都是纯本地实现：

| 组件 | 依赖 | 自建难度 |
|------|------|---------|
| 文件邮箱 | JSON 文件 + proper-lockfile | ⭐ 极简 |
| UDS 通信 | Node.js `net` 模块 | ⭐⭐ 简单 |
| 权限代理 | 邮箱协议消息 | ⭐⭐ 简单 |
| 团队管理 | team.json 文件 | ⭐ 极简 |

### 7.2 Teleport — 可部分替代，核心需自建

**结论：⚠️ 需要自建 3 个核心组件，但完全可行。**

Teleport 的 6 大功能拆解：

| CCR 功能 | 能否替代 | 替代方案 |
|---------|---------|---------|
| 容器环境 | ✅ | Docker / Kubernetes |
| 代码仓库管理 | ✅ | Git 操作 + Docker Volume |
| AI 执行引擎 | ✅ | 容器内运行 Claude Code 或自建 Agent |
| 事件流存储 | ✅ | Redis Stream / PostgreSQL / 文件 |
| 会话管理 | ✅ | 自建 REST API |
| 专用任务 | ✅ | 自定义 Agent 定义 |

### 7.3 自建实现架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     自建 CCR 替代方案                             │
│                                                                   │
│  ┌─────────────┐     ┌──────────────────┐     ┌──────────────┐  │
│  │ Claude Code │     │ Session Manager  │     │ Docker Pool  │  │
│  │ (本地 CLI)  │────▶│ (REST API 服务)  │────▶│ (容器集群)   │  │
│  └─────────────┘     └──────────────────┘     └──────────────┘  │
│        │                     │                       │           │
│        │              ┌──────┴──────┐         ┌──────┴──────┐   │
│        │              │ Event Store │         │ Git Manager │   │
│        │              │ (事件存储)  │         │ (仓库管理)  │   │
│        │              └─────────────┘         └─────────────┘   │
│        │                                                         │
│        └──── MCP Server 或 自定义 CLI 插件 ─────────────────────│
└──────────────────────────────────────────────────────────────────┘
```

### 7.4 具体实现思路

#### 组件 1: Session Manager (REST API)

```python
# FastAPI 实现 — 兼容 CCR 接口格式

from fastapi import FastAPI
import docker
import uuid

app = FastAPI()
client = docker.from_env()
sessions = {}  # 生产环境用 PostgreSQL

@app.post("/v1/sessions")
async def create_session(body: dict):
    session_id = str(uuid.uuid4())
    context = body["session_context"]

    # 1. 创建 Docker 容器
    container = client.containers.run(
        "claude-agent:latest",
        detach=True,
        environment={
            "SESSION_ID": session_id,
            "MODEL": context.get("model", "claude-sonnet-4-20250514"),
            "ANTHROPIC_AUTH_TOKEN": "your-token",
            "ANTHROPIC_BASE_URL": "https://your-gateway.com",
        },
        volumes={
            f"/data/sessions/{session_id}": {"bind": "/workspace", "mode": "rw"},
            f"/data/events/{session_id}": {"bind": "/events", "mode": "rw"},
        },
    )

    # 2. 初始化代码仓库
    if context.get("seed_bundle_file_id"):
        # 从上传的 bundle 解压
        init_from_bundle(session_id, context["seed_bundle_file_id"])
    elif context["sources"][0]["type"] == "git_repository":
        # 克隆 Git 仓库
        clone_repo(session_id, context["sources"][0]["url"], context["sources"][0].get("revision"))

    # 3. 注入初始事件
    for event in body.get("events", []):
        append_event(session_id, event)

    sessions[session_id] = {
        "id": session_id,
        "status": "running",
        "container_id": container.id,
        "context": context,
        "created_at": datetime.utcnow().isoformat(),
    }
    return sessions[session_id]

@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: str):
    return sessions[session_id]

@app.get("/v1/sessions/{session_id}/events")
async def get_events(session_id: str, after_id: str = None):
    # 从事件存储中读取，支持游标分页
    events = read_events(session_id, after_cursor=after_id)
    return {"data": events, "has_more": len(events) >= 100}

@app.post("/v1/sessions/{session_id}/events")
async def send_event(session_id: str, body: dict):
    # 写入事件文件，容器内 Agent 会读取
    for event in body["events"]:
        append_event(session_id, event)
    return {"status": "ok"}

@app.post("/v1/sessions/{session_id}/archive")
async def archive_session(session_id: str):
    container = client.containers.get(sessions[session_id]["container_id"])
    container.stop()
    sessions[session_id]["status"] = "archived"
    return sessions[session_id]
```

#### 组件 2: Docker 容器内的 Agent

```dockerfile
# Dockerfile: claude-agent
FROM node:20-slim

RUN apt-get update && apt-get install -y git python3

# 安装你的 Agent 运行时
COPY agent-runtime /app
WORKDIR /workspace

# 入口脚本: 读取事件 → 执行 → 写回事件
ENTRYPOINT ["/app/run-agent.sh"]
```

```bash
#!/bin/bash
# run-agent.sh — 容器内 Agent 入口

# 1. 读取初始事件
EVENTS=$(cat /events/pending/*.json)

# 2. 执行 Agent (你的自建 Agent 或 Claude Code)
node /app/agent.js \
  --model "$MODEL" \
  --events "$EVENTS" \
  --event-output "/events/output/" \
  --workspace "/workspace"

# 3. 推送代码变更
cd /workspace
git add -A
git commit -m "Changes from remote agent session $SESSION_ID"
git push origin HEAD:claude/$SESSION_ID
```

#### 组件 3: 事件存储

```python
# 简单文件存储方案 (可升级为 Redis Stream / PostgreSQL)

import json, os, time
from pathlib import Path

EVENTS_DIR = Path("/data/events")

def append_event(session_id: str, event: dict):
    """追加事件到会话事件文件"""
    event_dir = EVENTS_DIR / session_id
    event_dir.mkdir(parents=True, exist_ok=True)

    event_id = f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    event["id"] = event_id

    with open(event_dir / f"{event_id}.json", "w") as f:
        json.dump(event, f)

def read_events(session_id: str, after_cursor: str = None, limit: int = 100):
    """读取会话事件，支持游标分页"""
    event_dir = EVENTS_DIR / session_id
    if not event_dir.exists():
        return []

    files = sorted(event_dir.glob("*.json"))
    events = []
    past_cursor = after_cursor is None

    for f in files:
        event = json.loads(f.read_text())
        if not past_cursor:
            if event["id"] == after_cursor:
                past_cursor = True
            continue
        events.append(event)
        if len(events) >= limit:
            break

    return events
```

#### 组件 4: 本地 MCP 客户端 (接入 Claude Code)

```json
// ~/.claude/settings.json — 配置 MCP 连接自建 CCR
{
  "mcpServers": {
    "remote-agent": {
      "command": "node",
      "args": ["/path/to/mcp-ccr-bridge/server.js"],
      "env": {
        "CCR_API_URL": "http://localhost:8000",
        "CCR_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

MCP Server 提供工具：

```typescript
// mcp-ccr-bridge/server.js
const tools = [
  {
    name: "remote_execute",
    description: "在远程 Docker 容器中执行 Agent 任务",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "任务描述" },
        model: { type: "string", description: "模型 ID" },
        timeout_minutes: { type: "number", default: 30 },
      },
      required: ["prompt"]
    }
  },
  {
    name: "remote_status",
    description: "查询远程会话状态",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" }
      },
      required: ["session_id"]
    }
  },
  {
    name: "remote_pull",
    description: "拉取远程会话结果（代码分支 + 对话记录）",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" }
      },
      required: ["session_id"]
    }
  }
]
```

### 7.5 自建方案对比

| 能力 | Anthropic CCR | 自建方案 | 差距 |
|------|-------------|---------|------|
| 容器环境 | 托管云 | Docker/K8s | 无差距 |
| GitHub 集成 | GitHub App | SSH Key / Token | 更简单 |
| 模型访问 | 内部直连 | 通过 API Gateway | 无差距 |
| Prompt Cache | 服务端共享 | 无法共享 | ❌ 成本略高 |
| 多 Agent Fleet | 原生支持 | Docker Compose | 无差距 |
| 计费控制 | Anthropic 计费 | 自行统计 | 无差距 |
| 运维成本 | 零运维 | 需要自行维护 | ⚠️ 需要投入 |

### 7.6 最小可行方案 (MVP)

如果只想实现 Teleport 的核心价值（远程执行 + 结果回传），MVP 方案：

```bash
# 1. 启动 Session Manager
docker compose up -d session-manager

# 2. 配置 MCP
# ~/.claude/settings.json 添加 remote-agent MCP Server

# 3. 使用
claude> 请用远程容器执行代码审查
# → Claude 自动调用 remote_execute MCP tool
# → Docker 容器启动 → Agent 执行 → 事件存储
# → Claude 轮询 remote_status → 完成后 remote_pull
# → git fetch + checkout 远程分支
```

**核心代码量估算**：
- Session Manager API: ~300 行 Python
- Docker Agent Runner: ~100 行 Shell/Node
- 事件存储: ~50 行 Python
- MCP Bridge Server: ~200 行 TypeScript
- **总计约 650 行代码**，即可实现自建 Teleport
