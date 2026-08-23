# Signal Desk｜信号台

每天看清 AI 世界与关注博主的真实更新，并从可追溯证据进入学习与选题。

## 当前交付

- 五个一级入口：今日、AI 动态、博主动态、学习与选题、来源。收件箱、知识库、复盘和 Job 管理降为设置中的二级入口。
- 今日页、AI 事件、博主内容、学习详情、选题证据和全部用户动作均读取或写入 Supabase；生产页面不导入 `demo-data.ts`。
- Demo 只在 `SIGNAL_DESK_DEMO_MODE=true` 时启用，页面明确标记且只展示诚实空状态。
- 配置 Supabase 后启用邮箱验证码认证；数据库迁移建立核心表、索引、pgvector、全文检索基础、默认工作区和 RLS。
- AIHot 完整链路：原始 payload、标准化、精确去重、事件候选聚类、可选 pgvector/AI 二次判断、跨源信号和每日简报。
- Get 笔记支持 API、独立 CLI Worker 和 HMAC Webhook；互动字段缺失时明确显示“互动数据不可用”。
- YouTube 使用官方只读 OAuth，按每个频道 uploads playlist 游标增量读取详情，并处理分页、配额、Short、直播、不可用视频和无字幕状态。
- Transcript Provider 链支持可配置 API、Worker 专用 `yt-dlp` 和 SRT/VTT/TXT 手动上传；没有字幕时明确降级。
- PostgreSQL Job 队列 Worker 使用 `FOR UPDATE SKIP LOCKED`、blocked 依赖、版本化幂等键、Lease heartbeat、指数退避与 Dead Letter。
- 单元、PostgreSQL 16 + pgvector 迁移/RLS 集成、服务端渲染和 Playwright 五入口 E2E 均有自动化测试。

## 本地运行

```bash
npm install
npm run dev
```

复制 `.env.example` 为 `.env.local` 并配置 Supabase 后，应用使用邮箱验证码登录。没有数据库配置时返回明确的未配置状态，不会自动混入 Demo；需要演示时显式设置两个 Demo 环境变量。

## 数据库

在新的 Supabase 项目执行：

```text
supabase/migrations/202608170001_signal_desk.sql
supabase/migrations/202608170002_signal_desk_v2.sql
supabase/migrations/202608170003_signal_desk_reliable_daily.sql
supabase/migrations/202608180001_signal_desk_concurrency.sql
supabase/migrations/202608180002_signal_desk_migration_audit.sql
```

迁移会建立扩展、核心表、默认工作区触发器与 RLS。不要把 Service Role Key 放入浏览器环境变量。

## 验证

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:rendered
npm run verify:live
```

`verify:live` 的状态含义：

- `verified_live`：本轮读取了真实接口或本机真实登录态；
- `manual_verification_required`：代码已就绪，但仍缺外部授权或部署凭证；
- `failed`：真实调用失败，会保留失败原因。

## 后台 Worker

```bash
DATABASE_URL=... npm run worker
```

Web 和 Worker 分开部署。Web 可部署到 Vercel、Cloudflare 或等价 Node 平台；Worker 适合 Railway、Render、Fly.io 或自托管容器。

详细说明见 [部署文档](docs/deployment.md)、[连接器文档](docs/connectors.md) 和 [验收边界](docs/verification.md)。
