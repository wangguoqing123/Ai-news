# 验收边界

## 本轮已实现并通过自动化测试

- 内容画像可在 `/settings/profile` 编辑；保存会生成新版本、明确当前激活版本，并可选择只影响新内容、重排 pending 或重排最近 7 天。
- 分析 Job 支持 `queued / running / blocked / succeeded / failed / dead_letter`；blocked 会记录原因、依赖、下次检查时间和最后检查时间。
- 分析幂等键包含内容或事件 ID、输入 hash、Prompt version、Profile version 和 Analysis version；显式重新分析使用限时幂等 rerun hash。
- 内容重复同步会比较标题、摘要、正文、sourceUpdatedAt、payload hash 和 content fingerprint；相同输入保留分析/分数/用户状态，变化输入写入 `content_versions` 后重新分析。
- 事件聚类只维护成员、原始摘要、主题和基础重要性；`event_analyses` 是解释字段的唯一事实源，首页和 AI 动态读取其 `real_change` 等字段。
- Transcript Provider 链支持可配置 API、Worker 专用 `yt-dlp` 和 SRT/VTT/TXT 上传；字幕完成后保存真实片段并重新触发分析。
- 学习播放器使用 YouTube IFrame API；`iframe src` 初始化后稳定，字幕跳转使用 `seekTo`，观看时长只累计实际播放时间并按 12 秒及页面隐藏/关闭补保存。
- `POST /api/sync/run` 只创建幂等 Job 并返回 HTTP 202；今日页和来源页轮询任务状态。
- Worker 写 Job heartbeat 与 Worker heartbeat，活跃任务不会被 cleanup 领取；Get 笔记增加 QPS、429 退避/抖动、单博主隔离和失败博主续跑标记。
- 首页采用最多五段的编辑式速览，博主内容按价值排序；博主动态默认 24 小时；选题证据可展开并回到事件、视频时间点、笔记、知识卡或实践任务。
- 跨来源主题覆盖产品、公司、模型、工具、技术概念和内容主题，并比较 24 小时、最近 7 天、前一 7 天和 30 天基线。

本机验证结果：

- `npm install`：通过；完整依赖树报告 15 个漏洞（2 low、13 high），`npm audit --omit=dev` 的生产依赖为 0 个漏洞；本轮未运行破坏性 `audit fix --force`。
- `npm run typecheck`：通过。
- `npm run lint`：通过，保留 4 个真实外部缩略图的 `img` 性能提示，无 error。
- `npm run test:unit`：37/37 通过。
- `npm run test:db`：PostgreSQL 16 + pgvector 中五份迁移、事务型 current 切换、Worker 锁所有权、画像版本、RLS 与迁移审计通过。
- `npm run test:e2e`：4/4 通过；其中字幕点击后播放器 `iframe src` 不变，异步同步返回 202。
- `npm run build`：通过。
- `npm run test:rendered`：3/3 通过。
- 本机 `yt-dlp 2026.7.4` 真实读取一个公开视频的人工英文字幕：61 个带时间轴片段；这次验证没有写入生产数据库。

## 生产迁移与部署回读

2026-08-18 已在 Supabase 生产项目执行：

- 迁移前在 `signal_desk_backup_20260818` schema 备份画像 1、内容 146、字幕 0、事件 2、趋势 2、Job 267。
- `202608170002`、`202608170003` 和 `202608180001` 已应用；003 在 SQL Editor 中先单独提交 blocked enum，再执行事务部分。
- `creator_content_analyses`、`event_analyses`、`content_versions`、`worker_heartbeats` 已可通过生产 PostgREST 读取。
- blocked enum、5 个事务函数、6 个关键索引、4 个调度计划和唯一 active profile 均已 SQL 回读。
- 使用两个临时生产 Auth 测试账号验证跨工作区读取为 0、跨工作区写入被 RLS 拒绝；两个测试账号已删除并回读无残留。
- Sites 私密版本 9 已部署，提交 `76e714a31d13af58b881c2ddd37acc282f15d5f6`；`/api/health` 返回 HTTP 200 和 `mode=supabase`。
- 生产数据仍为内容 146、Job 267、字幕 0；本轮尚未启动 Worker 消费。

首次直接在 SQL Editor 运行完整 003 返回 PostgreSQL `55P04` 并整次回滚，没有被当作成功；按 enum 独立提交后重新执行并回读通过。

## 仍然阻塞生产验收

- `202608180002_signal_desk_migration_audit.sql` 尚未在生产执行，等待浏览器控制恢复后写入迁移审计表。
- OpenAI Platform 仍需用户完成登录；AI Provider 尚未创建或配置，267 个既有 Job 没有被消费，也没有真实 token、成本或结构化输出。
- 生产环境仍未配置 Transcript Provider。虽然本机 `yt-dlp` Provider 已完成一次真实公开字幕读取，但生产 `transcripts` 仍为 0，尚未由常驻 Worker 写入。
- 常驻 Worker 需要重置 Supabase 数据库密码以生成新的 session-pooler `DATABASE_URL`；重置前等待用户明确确认，LaunchAgent 尚未安装。
- 本轮没有重新执行 AIHot、YouTube 或 Get 笔记真实同步；生产数量保持上面的只读回读值。

在迁移审计、常驻 Worker、AI Provider、Transcript Provider 和既有 Job 消费结果全部回读之前，PR 必须保持 Draft，产品不得标记为 production ready。
