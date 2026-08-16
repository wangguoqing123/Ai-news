# Signal Desk｜信号台

个人内容情报、学习与选题工作台。它把 YouTube 订阅、AIHot 资讯和 Get 笔记竞品内容统一为四个对象：Signal、Learning、Knowledge、Topic。

## 当前交付

- 可运行的响应式 Web 产品，包含今日、收件箱、学习、情报、竞品、选题、知识库、复盘、来源和设置。
- 无外部凭证时自动使用 Demo Connector，所有核心按钮均有可见结果，Demo 状态保存在当前设备并可重置。
- 配置 Supabase 后启用邮箱验证码认证；数据库迁移建立核心表、索引、pgvector、全文检索基础、默认工作区和 RLS。
- AIHot 使用公开只读 v1 API，页面会尝试读取真实 24 小时信号并明确标注真实或 Demo。
- Get 笔记已通过本机 CLI 只读验证；云端部署使用可配置 JSON 字段映射，不在业务层硬编码未知 API 字段。
- YouTube 实现官方只读 uploads playlist 连接器；完成 Google OAuth Client 配置后才能导入用户真实订阅。
- 独立 Transcript Provider 接口与手动 SRT Provider；没有字幕时仍可保存并使用标题、简介和章节。
- PostgreSQL Job 队列 Worker 使用 `FOR UPDATE SKIP LOCKED`、Lease、幂等键、指数退避与 Dead Letter。
- 评分、去重指纹、Job 重试、字幕解析、连接器映射均有单元测试。

## 本地运行

```bash
npm install
npm run dev
```

未配置环境变量时直接进入 Demo 模式。复制 `.env.example` 为 `.env.local` 并配置 Supabase 后，应用会改为邮箱验证码登录。

## 数据库

在新的 Supabase 项目执行：

```text
supabase/migrations/202608170001_signal_desk.sql
```

迁移会建立扩展、核心表、默认工作区触发器与 RLS。不要把 Service Role Key 放入浏览器环境变量。

## 验证

```bash
npm run typecheck
npm run test:unit
npm run build
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
