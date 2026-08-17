# 部署

## 1. Supabase

1. 新建 Supabase 项目。
2. 按顺序执行 `202608170001_signal_desk.sql` 和 `202608170002_signal_desk_v2.sql`。
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

V2 迁移为每个现有工作区建立北京时间计划：06:15 AIHot、06:20 YouTube、06:25 Get 笔记、06:30 Daily Brief。常驻 Worker 每 30 秒读取 `job_schedules`，只创建幂等 Job；Web 进程不承担后台调度。

## 5. 回滚

V2 是只增不改的迁移。生产执行前先在 staging 项目验证；回滚使用 Supabase 备份或删除 V2 新表与计划记录，不修改已经执行的迁移文件。
