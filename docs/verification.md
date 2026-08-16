# 验收边界

## 本轮已真实验证

- AIHot 公开只读 v1 API 可访问。
- Get 笔记 CLI 已认证，可读取 `Ai 自媒体对标博主` 知识库中的真实账号列表。
- Web 页面、API Route、TypeScript 与核心单元测试在当前机器运行。

## Demo Connector 验证

- 从同步、收件箱、学习、笔记、知识卡、选题到复盘的交互流程。
- Demo 视频、字幕、评分和部分事件内容是演示数据，不是用户 YouTube 订阅或 AI 事实证据。
- Demo 设备状态使用 localStorage；生产业务数据以 Supabase 为唯一事实源。

## 仍需外部授权后验证

- Supabase 新项目创建、迁移执行、Email OTP 和跨用户 RLS 实测。
- Google Cloud OAuth Client 创建、YouTube 用户授权、订阅导入和 uploads playlist 增量同步。
- Get 笔记云端部署 API Endpoint、Token 和最终字段映射；当前真实验证来自本机 CLI。
- 任一 AI Provider 的真实结构化输出、token / 成本日志和长字幕生产分析。

没有取得外部授权的项目不得标为 production ready。
