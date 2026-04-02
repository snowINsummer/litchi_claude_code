# Android 模拟器操控 MCP Server 调研 TODO

## 调研背景

基于 Claude Code 源码分析，确认：
- Claude Code 内置 Computer Use 仅支持 **macOS 桌面 App** 操控（通过 `@ant/computer-use-swift` + `@ant/computer-use-input`）
- **不支持** Windows 桌面 App、Linux 桌面 App
- **不支持** 手机操控（无 ADB/Appium 集成）
- **不支持** Android 模拟器（雷电、BlueStacks、Nox 等）

## 技术方案选型

**MCP Server 优于 Skill**，原因：
1. 模拟器操控本质是"工具调用"，需要结构化参数（坐标、命令），不是 prompt 模板
2. MCP 原生支持返回 base64 图片，模型可直接"看到"截屏
3. Claude Code 自身的 Computer Use 也是用 MCP 实现的（`src/utils/computerUse/setup.ts`）
4. MCP Server 可保持 ADB 连接状态，Skill 无状态
5. MCP 工具可被任何 MCP 客户端复用，不限于 Claude Code

## 目标架构

```
Claude Code ──MCP──▶ android-emulator-mcp-server
                          │
                          ├── screenshot()         → adb screencap → base64 图片
                          ├── tap(x, y)            → adb shell input tap
                          ├── swipe(x1,y1,x2,y2)  → adb shell input swipe
                          ├── input_text(text)     → adb shell input text
                          ├── press_key(key)       → adb shell input keyevent
                          ├── list_devices()       → adb devices
                          ├── install_app(apk)     → adb install
                          ├── launch_app(pkg)      → adb shell am start
                          └── get_ui_tree()        → adb shell uiautomator dump (可选)
```

## 配置方式

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "android-emulator": {
      "command": "node",
      "args": ["path/to/android-emulator-mcp-server.js"],
      "env": { "ADB_PATH": "/path/to/adb" }
    }
  }
}
```

## 待调研事项

- [ ] 调研 `@modelcontextprotocol/sdk` 搭建 MCP Server 的流程
- [ ] 调研 ADB 命令在雷电模拟器上的兼容性（雷电自带 adb 端口映射）
- [ ] 调研截屏方案：`adb screencap` vs `minicap` 性能对比
- [ ] 调研 `uiautomator dump` 获取 UI 树的可行性（辅助模型理解界面元素）
- [ ] 调研是否需要支持多设备/多模拟器同时连接
- [ ] 调研现有开源 Android MCP Server 项目，避免重复造轮子
- [ ] 确定开发语言：TypeScript (Node) vs Python
- [ ] 评估是否需要额外支持 iOS 模拟器（Xcode Simulator + simctl）
