# AI提醒工具 · 安心提醒 EasyCare v1.4.0 审查与完善报告（v1.3.0 报告在下方保留）

本轮：通读 web/index.html、server/server.js、electron/main.js、sw.js，逐项复现再修复，改动清单见 CHANGELOG v1.4.0。`npm test` 83 + 22 项、`npm run test:ui` 35 项、`npm run test:e2e` 8 项全过。

**仍需真机验证（本轮同样没有做）**：Electron 托盘与窗口收起/前置、摄像头授权竞态修复、真机 TTS 与听写、iOS/Android 后台通知、跨设备同步、Windows/macOS 安装包。这些在沙箱里无法运行，只做了语法检查与代码审查。

---

# v1.3.0 打磨报告（历史）

- 库房名：`AI提醒工具`，仓库地址 `enoonc-sketch/ai-reminder-tool`（T 2026-11-16 定；GitHub 仓库名只允许字母数字与 - _ .，中文名放在标题与说明里）
- 底包：T 2026-11-16 06:36 发来的 easycare-v1-3.zip（SHA256 8b9120a0…49b83e，135K）
- 打磨后：v1.3.0，工作树 ~/workspace/work-easycare-v3/
- 方法：每轮先写测试复现，改完再测，循环到通过；测试脚本留下来（tests/test.js、tests/server-test.js）

## v1-3 的核实结论

v1-3 是基于 v1 原包做的（不是基于 v1.2.0），新增 8 类功能，但丢了 v1.1.0/v1.2.0 的全部修复：没有种子数据、回到暖绿主题、没有离线中文解析、AI 截图开关被拿掉、Electron 路径守卫没了且全域 CORS 回来了、服务器截断没了、版本号回到 1.0.0、没有测试。处理：只把它的新功能合进 v1.2.0，旧底包本身不直接用。

v1-3 新增并合入的功能：沟通页（常用语、打字转语音、听写字幕、呼叫家人）、呼叫求助同步与家人端红色提示、提前预告（5/10/15/30 分钟）、无障碍六项（超大按钮、闪屏加震动、读出今天的安排、键盘确认、点屏幕确认、家人锁）、读屏焦点与键盘操作。

## 保留的 v1.2.0 修复（v1-3 原包里没有的）

种子数据、苹果浅色风、离线中文解析（含中文数字）、AI 截图默认关闭、Electron 路径守卫且无全域 CORS、录音容量保护、服务器截断、测试与文档。

## 测试

- `npm test` 47 项全过：种子数据、离线中文解析、重复规则、输入校验、本地小模型免密钥调用与 JSON 模式、get-llm.js 官方下载源、Electron 路径守卫、提前预告、沟通常用语。
- `tests/server-test.js` 11 项全过：启动、供页、建家庭码、推拉同步、错码 401、通知白名单、服务器截断、呼叫求助记录同步。
- `node --check`：server.js、electron/main.js、scripts/get-llm.js、网页内联 JS 全通过。
- 合并时曾出两个真问题并已修：解析脚本的正则提不到 parseNL（改按位置切片）、合并脚本变量名把路径覆盖成字符串（改名后重跑通过）。

## 仍需真机验证

- 真机 TTS 发声、麦克风录音 / 语音识别、听写字幕准确率
- iOS 后台与锁屏本地通知、Android 权限与震动
- Windows / macOS 安装包打包与安装（含 `npm run get-llm` 下载 0.4GB 模型，须在对应系统上跑）
- 家庭同步跨设备（两台真机 + HTTPS 服务器）、呼叫求助端到端
- 无障碍功能请相应人群试用后再调整（README 已注明未经真实使用者测试）

## 发布到 GitHub

仓库 `enoonc-sketch/ai-reminder-tool`（公开）。推送内容不含 `.github/workflows/`（应用推送会被 403 拒绝，工作流文件请在网页手动上传）；打 tag `v1.3.0` 触发打包。

## 源码包

- ~/workspace/your_files/EasyCare-Source-v1.3.0.zip（见 SHA256，以打包时实测为准）
