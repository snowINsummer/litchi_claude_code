# LitchiCode

> 基于 Claude Code 源码恢复的 AI 命令行工具

---

> **🎁 通过我的邀请码注册可获得免费余额！**
> **注册链接**: [https://cc.zhihuiapi.top/register?aff=NyG7](https://cc.zhihuiapi.top/register?aff=NyG7)
> **注册即送额度，支持 Claude/GPT/Gemini 等模型！**

---

## 特性

- 🤖 **AI 驱动** - 支持 Claude AI 进行软件工程任务
- 🌐 **中转 API** - 支持官方 API 和第三方代理
- 💾 **配置持久化** - 多配置源支持
- 🔧 **交互模式** - 完整的 REPL 交互体验
- 📁 **源码恢复** - 基于 Claude Code 泄露源码构建

## 快速开始

### 环境要求

- **运行时**: Bun 1.0+ 或 Node.js 18+
- **系统**: Windows / macOS / Linux

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd claude_code_src-master

# 使用 Bun 运行 (推荐)
bun install
bun run src/index.ts

# 使用 npm/npx
npm install
npx tsx src/index.ts
```

### 首次运行

```bash
# 直接运行，工具会引导配置
bun run src/index.ts

# 或设置 API Token 后运行
export ANTHROPIC_AUTH_TOKEN="your-api-key"
bun run src/index.ts
```

## 配置中转 API

### 为什么需要中转 API？

- 💰 **成本更低** - 中转 API 价格更优惠
- 🇨🇳 **国内直连** - 无需翻墙，响应更快
- 🔓 **模型更全** - 支持更多模型类型

### 支持的中转 API

| 服务商 | 注册地址 | 特点 |
|--------|----------|------|
| 智汇 API | [cc.zhihuiapi.top](https://cc.zhihuiapi.top/register?aff=NyG7) | 注册送额度，支持 Claude 全系列 |
| 硅基流动 | [siliconflow.cn](https://siliconflow.cn) | 性价比高 |
| 其他兼容 API | - | 需确认 API 格式 |

### 配置步骤

#### 1. 注册获取 API Key

1. 访问 [https://cc.zhihuiapi.top/register?aff=NyG7](https://cc.zhihuiapi.top/register?aff=NyG7)
2. 注册账号
3. 进入控制台 → API Keys
4. 创建新的 API Key

#### 2. 配置 API 地址和 Key

**方式一：创建配置文件**

```bash
# Windows
mkdir %USERPROFILE%\.litchi
notepad %USERPROFILE%\.litchi\config.json

# Linux/macOS
mkdir -p ~/.litchi
nano ~/.litchi/config.json
```

**配置文件内容**：

```json
{
  "baseUrl": "https://cc.zhihuiapi.top/v1",
  "authToken": "sk-your-api-key-here",
  "model": "claude-sonnet-4-20250514"
}
```

**方式二：环境变量**

```bash
# Windows PowerShell
$env:ANTHROPIC_BASE_URL="https://cc.zhihuiapi.top/v1"
$env:ANTHROPIC_AUTH_TOKEN="sk-your-api-key-here"

# Windows CMD
set ANTHROPIC_BASE_URL=https://cc.zhihuiapi.top/v1
set ANTHROPIC_AUTH_TOKEN=sk-your-api-key-here

# Linux/macOS
export ANTHROPIC_BASE_URL="https://cc.zhihuiapi.top/v1"
export ANTHROPIC_AUTH_TOKEN="sk-your-api-key-here"
```

**方式三：Claude Code 兼容格式**

```json
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-your-api-key-here",
    "ANTHROPIC_BASE_URL": "https://cc.zhihuiapi.top/v1"
  }
}
```

### 常用模型配置

```json
{
  "baseUrl": "https://cc.zhihuiapi.top/v1",
  "authToken": "sk-your-api-key",
  "model": "claude-sonnet-4-20250514"
}
```

**支持的模型**：

| 模型 ID | 说明 | 推荐场景 |
|---------|------|----------|
| `claude-sonnet-4-20250514` | 均衡型 | 日常开发首选 |
| `claude-opus-4-20250514` | 旗舰型 | 复杂任务 |
| `claude-3-5-sonnet-latest` | 经济型 | 简单任务 |

> 注意：不同中转 API 的模型 ID 可能不同，请参考各平台文档。

## 使用教程

### 交互模式

启动交互式对话：

```bash
bun run src/index.ts
```

进入后可以看到：

```
╔══════════════════════════════════════════════════════════════╗
║  ╝═╔╝╔═╝║ ║╝╔═╝╔═║╔═ ╔═╝                                    ║
║  ║ ║ ║  ╔═║║║  ║ ║║ ║╔═╝                                    ║
║══╝╝ ╝ ══╝╝ ╝╝══╝══╝══ ══╝                                    ║
║                                                              ║
║   LitchiCode v2.1.88                                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

litchi> _
```

### 基本对话

```bash
litchi> 你好，帮我写一个快速排序算法
```

### 命令行操作

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示帮助 | `litchi> /help` |
| `/exit` | 退出程序 | `litchi> /exit` |
| `/clear` | 清屏 | `litchi> /clear` |
| `/model <id>` | 切换模型 | `litchi> /model opus` |
| `/models` | 列出可用模型 | `litchi> /models` |
| `/cost` | 查看 Token 用量 | `litchi> /cost` |
| `/new` | 新对话 | `litchi> /new` |

### 多行输入

输入多行代码或长文本时，输入 `...` 并回车发送：

```
litchi> 帮我写一个函数，实现以下功能：
... function add(a, b) {
...   return a + b;
... }
... ...
```

### 非交互模式

直接执行单次命令：

```bash
# 简单提问
bun run src/index.ts -p "解释这段代码的含义"

# 指定模型
bun run src/index.ts -m opus -p "帮我重构这段代码"

# 查看帮助
bun run src/index.ts --help
```

### 命令行参数

| 参数 | 说明 |
|------|------|
| `-p, --print <text>` | 非交互模式，直接执行 |
| `-m, --model <id>` | 指定使用的模型 |
| `-v, --version` | 显示版本信息 |
| `-h, --help` | 显示帮助信息 |
| `--verbose` | 显示详细日志 |

## 应用场景

### 1. 代码解释

```
litchi> 解释这段代码的作用：
```javascript
const arr = [3, 1, 4, 1, 5, 9, 2, 6];
console.log(arr.sort((a, b) => a - b));
```
```

### 2. 代码审查

```
litchi> 审查以下代码并提出改进建议：
```

### 3. Bug 修复

```
litchi> 这个函数报错了，请帮我修复：
```

### 4. 技术问答

```
litchi> 解释什么是 RESTful API
```

### 5. 学习助手

```
litchi> 用简单的语言解释什么是闭包
```

## 项目结构

```
claude_code_src-master/
├── src/
│   ├── index.ts              # 主入口 (推荐使用)
│   ├── cli-bootstrap.ts      # Bootstrap 入口
│   ├── cli-wrapper.ts        # CLI 包装器
│   ├── entrypoints/         # 原始入口 (需适配)
│   ├── main.tsx             # 主程序
│   ├── commands/            # 命令系统
│   ├── components/           # React 组件
│   ├── services/            # 服务层
│   └── tools/               # 工具系统
├── node_modules/             # 依赖
├── package.json             # 包配置
├── tsconfig.json           # TypeScript 配置
├── bunfig.toml            # Bun 配置
└── README.md              # 本文件
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Bun 1.0+ / Node.js 18+ |
| 语言 | TypeScript |
| UI | chalk (终端样式) |
| API | Anthropic SDK |
| 源码 | Claude Code 2.1.88 |

## 常见问题

### Q: 显示 "No API configuration found"

**A**: 需要配置 API Key。请参考上方「配置中转 API」章节。

### Q: API 调用失败

**A**: 检查以下几点：
1. API Key 是否正确
2. API 地址是否正确（注意 `/v1` 后缀）
3. 账户余额是否充足

### Q: 模型不支持

**A**: 不同中转 API 支持的模型不同，请登录平台查看可用模型列表。

## 发布到网络

### 1. 构建可执行文件

```bash
# 使用 pkg 打包
npm install -g pkg
pkg src/index.ts --targets node18 --output litchi

# 或使用 bun 构建
bun build src/index.ts --target=bun --outfile=litchi
```

### 2. 发布到 npm

```bash
# 更新 package.json 版本号
npm version patch
npm publish
```

### 3. 发布到 GitHub Releases

```bash
# 安装 gh CLI
gh auth login

# 创建 Release
gh release create v2.1.88 \
  --title "LitchiCode v2.1.88" \
  --notes "基于 Claude Code 源码恢复的 AI CLI 工具"
```

## 许可

本项目仅供研究学习。原始代码版权归 Anthropic 所有。

---

**🌐 注册中转 API 即送额度**: [https://cc.zhihuiapi.top/register?aff=NyG7](https://cc.zhihuiapi.top/register?aff=NyG7)

*LitchiCode - 让 AI 编程更简单*
