# 验收边界

## 本轮已实现并通过自动化测试

- YouTube 已改为 Metadata First：自动同步只保存基础信息、中文翻译和初步判断，不创建字幕或深度分析任务；重点频道也不例外。
- `POST /api/content/:id/process` 创建幂等深度处理请求，按 `fetch_transcript → translate_transcript → analyze_creator_content → finalize_processing_request` 流转；同一内容同一时间只有一个 active 请求。
- 中文 Metadata 和 Transcript 翻译均按输入 Hash 复用；字幕保持 segment ID 与时间戳，一一回填 `translated_text`，部分完成可续跑。
- Daily Brief 支持 `provisional / final / failed`，Final 不等待 YouTube 字幕或深度分析；首页展示生成时间、剩余任务和 Worker 心跳告警。
- AIHot 多旧 Cluster 通过数据库 advisory lock 事务合并，成员只能归属一个 Cluster；语义合并会失效旧 current 分析并重排主 Cluster。
- `material_content_hash` 与 `metrics_hash` 已拆分；指标变化只写快照。failed 原 Job 可归零重排，dead letter 保留原 Job 并创建带 `requeuedFromJobId` 的新 Job。

- 内容画像可在 `/settings/profile` 编辑；保存会生成新版本、明确当前激活版本，并可选择只影响新内容、重排 pending 或重排最近 7 天。
- 分析 Job 支持 `queued / running / blocked / succeeded / failed / dead_letter`；blocked 会记录原因、依赖、下次检查时间和最后检查时间。
- 分析幂等键包含内容或事件 ID、输入 hash、Prompt version、Profile version 和 Analysis version；显式重新分析使用限时幂等 rerun hash。
- 内容重复同步会比较标题、摘要、正文、sourceUpdatedAt、payload hash 和 content fingerprint；相同输入保留分析/分数/用户状态，变化输入写入 `content_versions` 后重新分析。
- 事件聚类只维护成员、原始摘要、主题和基础重要性；`event_analyses` 是解释字段的唯一事实源，首页和 AI 动态读取其 `real_change` 等字段。
- Transcript Provider 链支持 Get 笔记真实口述正文、Worker 专用 `yt-dlp`、可配置 API 和 SRT/VTT/TXT 上传；无时间轴文本保持 `has_timestamps=false`，字幕完成后按来源重新触发创作者或竞品分析。
- 学习播放器使用 YouTube IFrame API；`iframe src` 初始化后稳定，字幕跳转使用 `seekTo`，观看时长只累计实际播放时间并按 12 秒及页面隐藏/关闭补保存。
- `POST /api/sync/run` 只创建幂等 Job 并返回 HTTP 202；今日页和来源页轮询任务状态。
- Worker 写 Job heartbeat 与 Worker heartbeat，活跃任务不会被 cleanup 领取；Get 笔记增加 QPS、429 退避/抖动、单博主隔离和失败博主续跑标记。
- 首页采用最多五段的编辑式速览，博主内容按价值排序；博主动态默认 24 小时；选题证据可展开并回到事件、视频时间点、笔记、知识卡或实践任务。
- 跨来源主题覆盖产品、公司、模型、工具、技术概念和内容主题，并比较 24 小时、最近 7 天、前一 7 天和 30 天基线。

本机验证结果：

- `npm install`：通过；完整依赖树报告 15 个漏洞（2 low、13 high），`npm audit --omit=dev` 的生产依赖为 0 个漏洞；本轮未运行破坏性 `audit fix --force`。
- `npm run typecheck`：通过。
- `npm run lint`：通过，保留 4 个真实外部缩略图的 `img` 性能提示，无 error。
- `npm run test:unit`：54/54 通过。
- `npm run test:db`：PostgreSQL 16 + pgvector 中九份迁移、Metadata/深度请求幂等、多旧 Cluster 合并、锁内两步 current 切换、Transcript 输入幂等、Worker 锁所有权、画像版本、RLS 与迁移审计通过。
- `npm run test:e2e`：4/4 通过；其中字幕点击后播放器 `iframe src` 不变，异步同步返回 202。
- `npm run build`：通过。
- `npm run test:rendered`：3/3 通过。
- 本机 `yt-dlp 2026.7.4` 真实读取一个公开视频的人工英文字幕：61 个带时间轴片段；这次验证没有写入生产数据库。

## 生产迁移与部署回读

2026-08-19 Metadata First 增量：

- 生产 PostgreSQL 17 完整备份完成后应用 `202608190001` 与 `202608190002`；后者修复 Supabase 将 pgcrypto 放在 `extensions` schema 时的函数搜索路径。
- 253 个旧 YouTube 自动字幕/创作者分析待办已取消，替换为 Metadata 翻译与初步判断；真实增量同步新增 3 条、刷新 131 条，没有自动创建 Transcript Job。
- 新增视频 `Even the Finance Guy Codes at Anthropic` 自动生成中文标题、中文摘要和 Metadata 初步判断；手动深度处理后取得 35 个时间轴字幕片段，35/35 有中文，中文深度分析与可回链选题证据完成。
- Worker 启动自检回读为：数据库、Codex CLI 结构化请求、yt-dlp、Get 笔记 CLI 登录、Keychain 全部健康。
- AIHot 真实 Worker 同步完成：10 条，8 个 active 分组，本轮 0 个需要合并；语义去重状态为 ready。精确的两个旧 Cluster 合并场景已在 PostgreSQL 集成测试中验证。

2026-08-18 已在 Supabase 生产项目执行：

- 迁移前在 `signal_desk_backup_20260818` schema 备份画像 1、内容 146、字幕 0、事件 2、趋势 2、Job 267。
- `202608170002`、`202608170003`、`202608180001`、`202608180002`、`202608180003` 和 `202608180004` 已应用；003 在 SQL Editor 中先单独提交 blocked enum，再执行事务部分。
- `creator_content_analyses`、`event_analyses`、`content_versions`、`worker_heartbeats` 已可通过生产 PostgREST 读取。
- blocked enum、5 个事务函数、Transcript 输入唯一索引、4 个调度计划和唯一 active profile 均已 SQL 回读；三类 current 切换在 advisory lock 内先关闭旧行再打开目标行，迁移审计含 6 条生产记录。
- 使用两个临时生产 Auth 测试账号验证跨工作区读取为 0、跨工作区写入被 RLS 拒绝；两个测试账号已删除并回读无残留。
- Supabase 数据库密码已按用户明确授权轮换；新密码只保存在 macOS Keychain，Worker 配置文件不含明文密码。session pooler 直连已回读数据库、角色和 Job 数。
- LaunchAgent `com.wangguoqing.signal-desk-worker` 已安装为常驻 Worker，生产 heartbeat 持续为 active；Worker bundle、环境文件和日志位于用户 Library，不依赖受 macOS TCC 限制的 Documents 路径。
- AI Provider 使用本机已登录的 Codex CLI，不配置或创建大模型 API Key。结构化 smoke test、生产事件分析、竞品分析和 YouTube 字幕分析均有真实 token/latency 记录，`cost_usd=0`。
- Transcript Provider 生产链为 `ingested_text,yt_dlp`。Get 笔记 36 条内容均有当前 `ready` Transcript，真实正文按无时间轴边界保存；YouTube 已有 3 条当前 `ready` Transcript，分别保存 626、428、415 个时间轴片段。同一输入的重复 Transcript 已合并且唯一索引回读为 0 个重复组。
- 3 条 YouTube Transcript 均完成版本化本地 Codex 分析，置信度为 0.91、0.91、0.94，返回 3～4 个推荐片段和完整 segment evidence refs；对应 AI runs 合计输入 181146 token、输出 8775 token、成本 0。
- 一次生产同步已完成：AIHot 拉取并标准化 12 条、创建 9 个事件簇；YouTube 读取 33 个订阅并标准化 121 条视频；Get 笔记读取 379 条详情、标准化最近窗口 36 条，0 次限流、0 个博主失败。
- YouTube 视频同步为 `partial_success`：32 个频道正常，`EliteTexts` 的 uploads playlist 返回官方 404 `playlistNotFound`；该单频道失败没有阻断其他频道。
- 生产 Daily Brief 已生成 5 条证据条目；基于真实证据的选题候选、验证任务和来源回链已写入并回读。
- Sites 最新分支头已私密部署；`/api/health` 返回 HTTP 200 和 `mode=supabase`。

首次直接在 SQL Editor 运行完整 003 返回 PostgreSQL `55P04` 并整次回滚，没有被当作成功；按 enum 独立提交后重新执行并回读通过。

## 当前生产边界

- `yt-dlp` 在生产公网出口读取 YouTube 字幕时会间歇收到 HTTP 429。失败会保留为 `failed` Transcript 记录并统一延后字幕抓取；只有缺少当前 ready Transcript 的创作者分析会同步延后，已成功写入字幕的分析会立即继续。不会把 429 标成 succeeded 或 manual_required。
- 本轮同步后仍有 134 组去重后的 YouTube Transcript / 创作者分析流水线等待上游限流窗口，常驻 Worker 会按 15 分钟退避继续消费。不得使用浏览器 Cookie、代理或挑战绕过来伪造生产成功。
- Worker 重启测试产生的孤立 `ai_runs` 会在 10 分钟阈值后标成 failed，已经完成的 Job 与 current 分析不受影响；这类运维中断与模型结构化输出失败分开统计。

数据库、常驻 Worker、本地 Codex AI、两类 Transcript Provider、三类真实同步和完整 YouTube Transcript→分析链均已通过。间歇 429 已作为受控外部退避状态处理，不再阻塞代码审查；PR 可以转为 Ready for Review。生产队列继续由常驻 Worker 消费，不能把等待退避的条目报告成已经完成。
