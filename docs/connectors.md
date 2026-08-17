# 连接器与字幕 Provider

## 通用约束

- 原始 payload 先写 `raw_ingest_records`，之后再标准化。
- Token 只在服务端加密存储，日志仅显示已脱敏状态。
- 单个来源失败不阻断其他来源。
- 原始记录可重放，字段映射按版本保存。
- 外部正文是不可信输入，AI Prompt 必须忽略其中的指令。

## AIHot

使用 `https://aihot.virxact.com/api/v1/*` 匿名只读接口。默认读取精选池 24 小时窗口。个人与内部使用需遵守 AIHot 条款；外部商业产品、数据转售或公开镜像需要书面授权。

同步顺序为 `raw_ingest_records → content_items → exact_dedupe → event_clusters → event_analysis → daily_briefs`。无 AI Provider 时，实体关键词候选聚类仍工作，语义二次判断与事件解释保持 `analysis_pending`。

## Get 笔记

`GET_NOTES_MODE` 支持 `api`、`cli`、`webhook`。CLI 只允许由独立 Worker 调用；Web Route 不启动本机进程。API 字段由 `GET_NOTES_FIELD_MAPPING` 配置，Webhook 使用 HMAC SHA-256、delivery ID 和 payload hash 防重放。

互动字段为空时保持 `null`，页面显示“互动数据不可用”，不得生成爆款或增长速度判断。

## YouTube

OAuth scope 仅请求 `https://www.googleapis.com/auth/youtube.readonly`。订阅导入后，通过频道 uploads playlist 增量读取视频，避免全局搜索配额与不稳定排序。

字幕不是 YouTube Data API 的必然能力。`TranscriptProvider` 独立于 YouTube Connector，可接入公开视频字幕、第三方字幕服务、语音转写或用户上传的 SRT/VTT/纯文本。没有字幕时仍保留视频并降级到标题、简介和章节。

每个频道以 `lastVideoPublishedAt` 为增量游标。同步写入真实缩略图、作者、发布时间、时长、章节、直播状态与可用互动指标；删除、私密或 playlist 不可用会逐频道记录失败，不阻断其他频道。
