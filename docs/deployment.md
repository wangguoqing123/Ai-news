# 部署

## 1. Supabase

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase/migrations/202608170001_signal_desk.sql`。
3. 在 Auth 中启用 Email OTP；Site URL 指向 Web 正式域名。
4. 设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`。
5. 只在 Worker / Server 环境设置 `SUPABASE_SERVICE_ROLE_KEY` 与 `DATABASE_URL`。
6. 用两个测试用户验证互相无法读取工作区数据。

## 2. Web

Web 构建命令是 `npm run build`。生产环境必须使用 HTTPS。PWA manifest 与 Service Worker 已包含，保存过的 Demo 文本可离线打开；Supabase 数据离线写入同步尚未实现。

## 3. Worker

Worker 使用 PostgreSQL 队列，不依赖 Redis。至少配置：

- `DATABASE_URL`
- `DATABASE_SSL`
- `WORKER_NAME`
- AI Provider 变量（需要运行 AI Job 时）

进程通过 SIGTERM / SIGINT 优雅停止。部署平台的健康检查应独立于 Web。

## 4. 定时任务

平台 Cron 调用受 `CRON_SECRET` 保护的调度入口，调度入口只创建幂等 Job；真正同步由 Worker 执行。建议频率：AIHot 60 分钟、YouTube 120 分钟、Get 笔记 360 分钟、Daily Brief 每天用户时区 07:30。

## 5. 回滚

当前迁移是初始建库迁移。生产执行前先在 staging 项目验证。后续迁移必须提供对应 down SQL 或通过 Supabase 备份恢复，不直接修改已执行迁移。
