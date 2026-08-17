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
- `npm run test:unit`：34/34 通过。
- `npm run test:db`：PostgreSQL 16 + pgvector 中三份迁移、画像版本、blocked Job、heartbeat、RLS 与证据关系通过。
- `npm run test:e2e`：4/4 通过；其中字幕点击后播放器 `iframe src` 不变，异步同步返回 202。
- `npm run build`：通过。
- `npm run test:rendered`：3/3 通过。
- 本机 `yt-dlp 2026.7.4` 真实读取一个公开视频的人工英文字幕：61 个带时间轴片段；这次验证没有写入生产数据库。

## 本轮真实生产只读回读

2026-08-17 使用当前项目已有的 Supabase Service Role 做只读计数，未输出凭据：

- `content_items`：146 条，其中 AIHot 2、YouTube 121、Get 笔记 23。
- `jobs`：267 个，全部仍为 `queued`。
- `transcripts`：0 条。
- `content_profiles`：1 个旧版本。
- `creator_content_analyses`、`event_analyses`：PostgREST 返回 `PGRST205`，说明生产尚未应用 V2 migration。
- `worker_heartbeats`：PostgREST 返回 `PGRST205`，说明可靠性 migration 也尚未应用。

这些是只读现状，不代表本轮完成了新的真实同步或分析。

## 仍然阻塞生产验收

- 当前环境没有 `DATABASE_URL` 或可执行 SQL 的生产权限，因此没有应用 `202608170002_signal_desk_v2.sql` 和 `202608170003_signal_desk_reliable_daily.sql`。精确备份、执行和检查命令见 `docs/deployment.md`。
- 当前环境未配置 AI Provider；267 个既有 Job 没有被消费，也没有真实 token、成本或结构化输出。
- 生产环境仍未配置 Transcript Provider。虽然本机 `yt-dlp` Provider 已完成一次真实公开字幕读取，但生产 `transcripts` 仍为 0，尚未由常驻 Worker 写入。
- 当前环境没有常驻 Worker 的 `DATABASE_URL` 和托管进程；06:15—06:30 调度没有上线，heartbeat 只完成代码和隔离数据库验证。
- 没有第二个生产测试账号，因此双用户隔离只在隔离 PostgreSQL 环境验证，尚未做生产复验。
- 本轮没有重新执行 AIHot、YouTube 或 Get 笔记真实同步；生产数量保持上面的只读回读值。

在 V2/可靠性迁移、常驻 Worker、AI Provider 和 Transcript Provider 真正配置并回读之前，PR 必须保持 Draft，产品不得标记为 production ready。
