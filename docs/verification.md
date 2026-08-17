# 验收边界

## 本轮已真实验证

- AIHot 公开只读 v1 API 可访问。
- AIHot 已真实写入 2 条内容并形成 2 个事件候选；每日简报由数据库记录生成。
- YouTube OAuth 已连接 33 个订阅频道，本轮发现 121 条增量内容，其中 122 次标准化写入（含针对单频道异常修复后的补跑）；一个频道 uploads playlist 不可用，按部分成功保留失败记录。
- Get 笔记 CLI 已认证到知识库 `J9o7AMeY`；本轮扫描 20 位博主、发现 378 条，受平台 QPS 限流影响新增 16 条具体内容，结果标记为部分成功。
- 独立的 Supabase `signal-desk` 项目已创建；初始迁移已在生产项目执行成功，核心表、pgvector、工作区触发器、RLS 与显式 Data API 角色权限已建立。
- Supabase 生产 Site URL、线上回调与本地回调已配置；本机和私有 Sites 环境已写入对应项目凭证。
- Web 页面、API Route、TypeScript、22 个单元测试、两份迁移/RLS 的隔离 PostgreSQL 集成测试和 2 个 Playwright E2E 在当前机器运行通过。

## 显式 Demo 隔离验证

- 只有环境变量显式开启时才进入 Demo。
- 五个一级页面显示 Demo 标识和空状态，不注入固定新闻、视频、评分、日期或完成状态。
- 生产业务数据以 Supabase 为唯一事实源。

## 仍需外部授权后验证

- Supabase Email OTP 的首次真实收信登录；跨用户 RLS 已在隔离 PostgreSQL 环境验证，生产项目需在第二个测试账号可用后复验。
- V2 迁移尚需拿到生产 `DATABASE_URL` 或 Supabase SQL 执行权限后应用；在隔离 pgvector PostgreSQL 已完整通过。
- 常驻 Worker 尚需生产 `DATABASE_URL` 与托管进程，06:15—06:30 计划才会在线执行。
- Get 笔记云端 API Endpoint、Token 和最终字段映射；当前真实内容验证来自本机 CLI。
- 任一 AI Provider 的真实结构化输出、token / 成本日志和长字幕生产分析。
- YouTube 公共字幕不属于官方 Data API；当前明确标记无字幕，后续需独立 Transcript Provider。

没有取得外部授权的项目不得标为 production ready。
