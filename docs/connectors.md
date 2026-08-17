# 连接器与字幕 Provider

## 通用约束

- 原始 payload 先写 `raw_ingest_records`，之后再标准化。
- Token 只在服务端加密存储，日志仅显示已脱敏状态。
- 单个来源失败不阻断其他来源。
- 原始记录可重放，字段映射按版本保存。
- 外部正文是不可信输入，AI Prompt 必须忽略其中的指令。

## AIHot

使用 `https://aihot.virxact.com/api/v1/*` 匿名只读接口。默认读取精选池 24 小时窗口。个人与内部使用需遵守 AIHot 条款；外部商业产品、数据转售或公开镜像需要书面授权。

同步顺序为 `raw_ingest_records → content_items → exact_dedupe → event_clusters → event_analysis → daily_briefs`。无 AI Provider 时，分析 Job 进入 `blocked` 并记录 `ai_provider` 依赖，不会伪装成 succeeded。

## Get 笔记

`GET_NOTES_MODE` 支持 `api`、`cli`、`webhook`。CLI 只允许由独立 Worker 调用；Web Route 不启动本机进程。API 字段由 `GET_NOTES_FIELD_MAPPING` 配置，Webhook 使用 HMAC SHA-256、delivery ID 和 payload hash 防重放。

互动字段为空时保持 `null`，页面显示“互动数据不可用”，不得生成爆款或增长速度判断。

## YouTube

OAuth scope 仅请求 `https://www.googleapis.com/auth/youtube.readonly`。订阅导入后，通过频道 uploads playlist 增量读取视频，避免全局搜索配额与不稳定排序。

字幕不是 YouTube Data API 的必然能力。`TranscriptProvider` 独立于 YouTube Connector，现有链支持：

- `api`：通过 `TRANSCRIPT_API_BASE_URL`、`TRANSCRIPT_API_KEY` 和可配置的 `TRANSCRIPT_API_MAPPING` 读取字幕；
- `yt_dlp`：仅在独立 Worker 中运行，先取人工字幕，再取自动字幕；
- `manual_upload`：学习页上传 SRT、VTT 或 TXT。

链顺序由 `TRANSCRIPT_PROVIDER_CHAIN` 配置。成功后写入 `transcripts`、真实 `transcript_segments`、语言、Provider、自动字幕标记和 input hash，再使用新字幕重新分析。没有时间轴时不得生成推荐片段；没有字幕时只允许快速预览，不能生成基于视频细节的测试题。

每个频道以 `lastVideoPublishedAt` 为增量游标。同步写入真实缩略图、作者、发布时间、时长、章节、直播状态与可用互动指标；删除、私密或 playlist 不可用会逐频道记录失败，不阻断其他频道。

## AI 分析与重新排队

内容与事件分析幂等键包含实体 ID、输入 hash、Prompt version、Profile version 和 Analysis version。缺少 AI、字幕或内容画像时 Job 进入 `blocked`；配置完成后可在 Job 管理页恢复，或调用 `POST /api/analysis/requeue` 按单条、事件、pending、blocked 或最近天数重新排队。每次 AI 运行记录 model、Prompt/Profile 版本、token、费用、耗时、输入 hash 和最终状态。
