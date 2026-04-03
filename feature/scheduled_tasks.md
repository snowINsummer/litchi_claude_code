# Claude Code 定时任务系统 — 一人公司多角色自动化方案

---

## 一、Durable Cron 机制详解

### 1.1 核心原理

Claude Code 的定时任务分两种存储方式：

| 类型 | 存储位置 | 生命周期 | 参数 |
|------|---------|---------|------|
| Session-only | 进程内存 | 会话结束即消失 | `durable: false`（默认） |
| **Durable** | `.claude/scheduled_tasks.json` | **跨会话持久化** | `durable: true` |

### 1.2 文件格式

文件位置：`<项目根目录>/.claude/scheduled_tasks.json`

```json
{
  "tasks": [
    {
      "id": "a1b2c3d4",
      "cron": "3 9 * * 1-5",
      "prompt": "你是产品经理角色，检查本周产品需求进度...",
      "createdAt": 1712102400000,
      "recurring": true
    },
    {
      "id": "e5f6g7h8",
      "cron": "7 10 * * 1-5",
      "prompt": "你是研发工程师角色，检查代码质量和待办任务...",
      "createdAt": 1712102400000,
      "recurring": true,
      "lastFiredAt": 1712188800000
    }
  ]
}
```

### 1.3 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 8 位 hex，自动生成 |
| `cron` | string | 是 | 标准 5 字段 cron，**本地时区** |
| `prompt` | string | 是 | 触发时注入的 prompt |
| `createdAt` | number | 是 | 创建时间戳（epoch ms） |
| `recurring` | boolean | 否 | `true`=循环执行，`false/省略`=单次执行后删除 |
| `lastFiredAt` | number | 否 | 上次触发时间戳，用于重启后恢复调度 |
| `permanent` | boolean | 否 | `true`=不受 7 天自动过期限制（仅系统内部使用） |

### 1.4 运行前提条件

```
1. Feature Flag: AGENT_TRIGGERS=true（编译时，开源版需确认）
2. GrowthBook gate: tengu_kairos_cron = true（运行时，默认 true）
3. Durable gate: tengu_kairos_cron_durable = true（运行时，默认 true）
4. 非禁用: 未设置 CLAUDE_CODE_DISABLE_CRON=1
```

**自建/API 网关场景注意**：GrowthBook 不可用时，两个 gate 均默认 `true`，所以 durable cron **默认可用**。只需确保编译时 `AGENT_TRIGGERS` flag 为 true。

### 1.5 调度器工作原理

```
Claude Code 启动
    │
    ▼
检查 .claude/scheduled_tasks.json 是否有任务
    │
    ├── 有 → 自动启用调度器
    │       ├── 获取项目级调度锁（防止多会话重复触发）
    │       ├── chokidar 监听文件变化
    │       ├── 每 1 秒 check() 检查是否到触发时间
    │       └── 触发时：将 prompt 注入到 REPL 消息队列
    │
    └── 无 → 轮询等待 CronCreate 创建任务
```

**关键限制**：
- 任务只在 REPL **空闲时**触发（不会打断正在进行的对话）
- 循环任务 **7 天后自动过期**（除非 `permanent: true`）
- 同一 cwd 下多个 Claude 会话通过文件锁互斥，只有一个会持有调度权
- 最多 **50 个**定时任务

---

## 二、创建方式

### 方式 1：通过 CronCreate 工具（对话中创建）

在 Claude Code 对话中直接说：

```
帮我创建一个持久化的定时任务，每个工作日早上 9 点执行产品经理日报
```

Claude 会调用 CronCreate：

```json
{
  "cron": "3 9 * * 1-5",
  "prompt": "你是产品经理角色，执行以下任务...",
  "recurring": true,
  "durable": true
}
```

### 方式 2：手动编辑 JSON 文件（推荐批量配置）

直接编辑 `.claude/scheduled_tasks.json`，调度器会通过 chokidar 监听自动加载：

```json
{
  "tasks": [
    {
      "id": "prod-mgr1",
      "cron": "3 9 * * 1-5",
      "prompt": "...",
      "createdAt": 1712102400000,
      "recurring": true
    }
  ]
}
```

> **注意**：手动编辑时 `id` 可以自定义（只要唯一），`createdAt` 需要是合法的 epoch 毫秒时间戳。

### 方式 3：通过 /loop 命令（会话级简易轮询）

```
/loop 30m 检查一下项目的 CI 状态
```

> 注：/loop 不支持 durable，仅当前会话有效。

---

## 三、一人公司多角色定时任务方案

### 3.1 角色定义

| 角色 | 触发时间 | Cron 表达式 | 职责 |
|------|---------|------------|------|
| 产品经理 | 工作日 9:03 | `3 9 * * 1-5` | 需求梳理、优先级排序、竞品分析 |
| 研发工程师 | 工作日 10:07 | `7 10 * * 1-5` | 代码审查、技术债务、bug 修复 |
| 运营 | 工作日 14:13 | `13 14 * * 1-5` | 数据分析、用户反馈、内容更新 |
| 每日复盘 | 工作日 17:47 | `47 17 * * 1-5` | 汇总三个角色的工作成果 |
| 周报生成 | 每周五 16:33 | `33 16 * * 5` | 生成本周工作周报 |

> cron 时间故意避开整点 :00 和 :30，遵循 Claude Code 的 jitter 最佳实践。

### 3.2 完整配置文件

```json
{
  "tasks": [
    {
      "id": "role-pm",
      "cron": "3 9 * * 1-5",
      "prompt": "## 角色：产品经理\n\n你现在是一人公司的产品经理。请执行以下晨间任务：\n\n1. **需求检查**：读取 docs/requirements/ 目录下的需求文档，检查哪些需求的状态是 TODO 或 IN_PROGRESS\n2. **优先级排序**：根据业务价值和技术复杂度，建议今天应该优先处理哪些需求\n3. **竞品动态**：如果 docs/competitive/ 目录存在，检查是否有需要关注的竞品更新记录\n4. **输出日报**：将分析结果写入 reports/daily/pm-{YYYY-MM-DD}.md\n\n注意：只分析和输出报告，不要修改任何源代码。",
      "createdAt": 1712102400000,
      "recurring": true
    },
    {
      "id": "role-dev",
      "cron": "7 10 * * 1-5",
      "prompt": "## 角色：研发工程师\n\n你现在是一人公司的研发工程师。请执行以下任务：\n\n1. **代码质量检查**：运行 lint 和类型检查，汇总错误和警告\n2. **测试状态**：运行测试套件，报告通过率和失败用例\n3. **Git 分析**：检查最近 3 天的 commit，识别可能的技术债务\n4. **TODO 扫描**：搜索代码中的 TODO/FIXME/HACK 注释，按优先级排列\n5. **输出日报**：将结果写入 reports/daily/dev-{YYYY-MM-DD}.md\n\n如果发现明显的 lint 错误或简单 bug，可以直接修复并提交。",
      "createdAt": 1712102400000,
      "recurring": true
    },
    {
      "id": "role-ops",
      "cron": "13 14 * * 1-5",
      "prompt": "## 角色：运营\n\n你现在是一人公司的运营人员。请执行以下午间任务：\n\n1. **数据检查**：如果项目有 analytics/ 或 data/ 目录，检查最新的数据报告\n2. **用户反馈**：检查 issues/ 或 feedback/ 目录中的用户反馈记录\n3. **文档更新**：检查 README.md 和 docs/ 目录是否有过时的内容\n4. **变更日志**：根据最近的 git log 更新 CHANGELOG.md（如果存在）\n5. **输出日报**：将结果写入 reports/daily/ops-{YYYY-MM-DD}.md\n\n注意：文档更新可以直接修改，但不要改动源代码。",
      "createdAt": 1712102400000,
      "recurring": true
    },
    {
      "id": "daily-review",
      "cron": "47 17 * * 1-5",
      "prompt": "## 角色：CEO（每日复盘）\n\n你现在是一人公司的 CEO，负责每日复盘。请执行：\n\n1. **汇总日报**：读取 reports/daily/ 目录下今天的 pm/dev/ops 三份日报\n2. **进度评估**：对比昨天和今天的进展，评估整体项目健康度\n3. **明日计划**：基于今天的成果，建议明天三个角色的重点工作\n4. **风险预警**：识别可能的阻塞项或风险\n5. **输出总结**：将每日总结写入 reports/daily/summary-{YYYY-MM-DD}.md",
      "createdAt": 1712102400000,
      "recurring": true
    },
    {
      "id": "weekly-report",
      "cron": "33 16 * * 5",
      "prompt": "## 角色：CEO（周报）\n\n今天是周五，请生成本周工作周报：\n\n1. **汇总本周**：读取 reports/daily/ 下本周一到周五的所有日报和 summary\n2. **关键成果**：提炼本周 3-5 项最重要的成果\n3. **数据指标**：汇总本周的代码提交数、测试通过率、bug 修复数等\n4. **下周规划**：基于本周进展，规划下周三个角色的重点方向\n5. **输出周报**：写入 reports/weekly/week-{YYYY}-W{WW}.md",
      "createdAt": 1712102400000,
      "recurring": true
    }
  ]
}
```

### 3.3 配套目录结构

```
project/
├── .claude/
│   └── scheduled_tasks.json    ← 定时任务配置
├── docs/
│   ├── requirements/           ← 需求文档（产品经理读取）
│   └── competitive/            ← 竞品分析（产品经理读取）
├── reports/
│   ├── daily/                  ← 每日报告输出
│   │   ├── pm-2026-04-03.md
│   │   ├── dev-2026-04-03.md
│   │   ├── ops-2026-04-03.md
│   │   └── summary-2026-04-03.md
│   └── weekly/                 ← 周报输出
│       └── week-2026-W14.md
└── src/                        ← 项目源代码
```

### 3.4 时间线可视化

```
工作日一天的任务流：

09:03  ┃ [产品经理] 需求梳理、优先级排序 → pm-日报
       ┃
10:07  ┃ [研发工程师] 代码检查、测试、TODO扫描 → dev-日报
       ┃
14:13  ┃ [运营] 数据分析、用户反馈、文档更新 → ops-日报
       ┃
17:47  ┃ [CEO复盘] 汇总三份日报 → summary-日报
       ┃
周五    ┃
16:33  ┃ [CEO周报] 汇总本周所有日报 → 周报
```

---

## 四、使用步骤

### Step 1: 创建目录结构

```bash
mkdir -p .claude reports/daily reports/weekly docs/requirements
```

### Step 2: 写入配置

将上面 3.2 节的 JSON 内容写入 `.claude/scheduled_tasks.json`。

或者在 Claude Code 中依次对话创建：

```
帮我创建以下持久化定时任务：
1. 工作日 9:03 执行产品经理角色任务，durable: true
2. 工作日 10:07 执行研发工程师角色任务，durable: true
3. 工作日 14:13 执行运营角色任务，durable: true
4. 工作日 17:47 执行每日复盘，durable: true
5. 每周五 16:33 生成周报，durable: true
```

### Step 3: 启动 Claude Code

```bash
cd your-project
claude
```

调度器检测到 `.claude/scheduled_tasks.json` 有任务后**自动启用**，无需额外操作。

### Step 4: 管理任务

```
# 查看所有定时任务
在对话中说：列出所有定时任务
# → 调用 CronList

# 删除某个任务
在对话中说：删除 role-pm 这个定时任务
# → 调用 CronDelete { id: "role-pm" }

# 也可以直接编辑 .claude/scheduled_tasks.json，调度器会自动热加载
```

---

## 五、注意事项与限制

### 5.1 核心限制

| 限制 | 说明 | 应对 |
|------|------|------|
| **7 天自动过期** | 循环任务创建 7 天后自动删除 | 需要定期重新创建，或设 `permanent: true`（未暴露给用户工具） |
| **需要会话运行** | Claude Code 必须保持运行状态 | 搭配 tmux/screen 后台运行：`tmux new -d -s claude 'claude'` |
| **空闲时才触发** | 正在对话时任务会延迟 | 避免在任务触发时间段进行长时间对话 |
| **最多 50 个任务** | 硬编码限制 | 合并相似角色任务 |
| **单项目单调度** | 同一 cwd 下只有一个会话持有调度锁 | 不要在同一目录开多个 Claude Code |

### 5.2 7 天过期的应对方案

**方案 A**：手动编辑 JSON 添加 `"permanent": true`

```json
{
  "id": "role-pm",
  "cron": "3 9 * * 1-5",
  "prompt": "...",
  "createdAt": 1712102400000,
  "recurring": true,
  "permanent": true
}
```

> `permanent` 字段无法通过 CronCreate 工具设置，只能手动编辑文件。源码中 CronCreateTool 不暴露此字段，它是为 assistant mode 的系统任务预留的。调度器会尊重此字段。

**方案 B**：写一个 cron 任务来重建其他 cron 任务（自举）

不推荐，过于复杂。

### 5.3 后台运行方案

```bash
# 方案 1: tmux
tmux new-session -d -s one-man-company 'cd /path/to/project && claude'

# 方案 2: 系统 launchd (macOS) 
# 创建 ~/Library/LaunchAgents/com.one-man-company.claude.plist

# 方案 3: systemd (Linux)
# 创建 /etc/systemd/user/claude-company.service
```

### 5.4 错过的任务处理

如果 Claude Code 在任务触发时间未运行：
- **一次性任务**：下次启动时会提示"missed task"，询问用户是否执行
- **循环任务**：不会补执行错过的，直接从当前时间计算下一次触发

---

## 六、进阶：结合 Agent 和 Skill 增强

### 6.1 为每个角色创建专用 Agent

```markdown
<!-- .claude/agents/product-manager.md -->
---
description: "产品经理角色，专注需求分析和优先级管理"
tools:
  - Read
  - Glob
  - Grep
  - Write
model: sonnet
maxTurns: 15
---

你是一人公司的产品经理。你的职责是...
```

然后在定时任务 prompt 中调用：

```json
{
  "prompt": "使用 product-manager agent 执行今天的产品经理任务，将报告输出到 reports/daily/pm-{日期}.md"
}
```

### 6.2 创建日报 Skill

```markdown
<!-- .claude/skills/daily-report/SKILL.md -->
---
description: "生成每日角色工作报告"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
argument-hint: "角色名 (pm/dev/ops/summary)"
---

根据参数 $ARGUMENTS 生成对应角色的每日工作报告...
```

---

## 七、快速开始模板

将以下内容保存为 `.claude/scheduled_tasks.json` 即可立即使用：

```json
{
  "tasks": [
    {
      "id": "role-pm",
      "cron": "3 9 * * 1-5",
      "prompt": "你是产品经理。请检查 docs/ 和 issues/ 目录，梳理今日需求优先级，输出到 reports/daily/pm-今日日期.md",
      "createdAt": 1712102400000,
      "recurring": true,
      "permanent": true
    },
    {
      "id": "role-dev",
      "cron": "7 10 * * 1-5",
      "prompt": "你是研发工程师。请运行 lint、测试，扫描 TODO/FIXME，检查最近 commit，输出到 reports/daily/dev-今日日期.md。简单 lint 错误可直接修复。",
      "createdAt": 1712102400000,
      "recurring": true,
      "permanent": true
    },
    {
      "id": "role-ops",
      "cron": "13 14 * * 1-5",
      "prompt": "你是运营。请检查数据报告、用户反馈、文档时效性，更新 CHANGELOG（如有），输出到 reports/daily/ops-今日日期.md",
      "createdAt": 1712102400000,
      "recurring": true,
      "permanent": true
    },
    {
      "id": "daily-review",
      "cron": "47 17 * * 1-5",
      "prompt": "你是 CEO。请汇总今天 reports/daily/ 下的 pm/dev/ops 日报，评估进度，规划明日工作，输出到 reports/daily/summary-今日日期.md",
      "createdAt": 1712102400000,
      "recurring": true,
      "permanent": true
    },
    {
      "id": "weekly-report",
      "cron": "33 16 * * 5",
      "prompt": "你是 CEO。今天周五，请汇总本周 reports/daily/ 所有日报，提炼关键成果和数据指标，规划下周方向，输出到 reports/weekly/week-本周编号.md",
      "createdAt": 1712102400000,
      "recurring": true,
      "permanent": true
    }
  ]
}
```
