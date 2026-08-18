# 部署

## 1. Supabase

1. 新建 Supabase 项目。
2. 按顺序执行 `202608170001_signal_desk.sql`、`202608170002_signal_desk_v2.sql`、`202608170003_signal_desk_reliable_daily.sql`、`202608180001_signal_desk_concurrency.sql` 和 `202608180002_signal_desk_migration_audit.sql`。
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
- Transcript Provider 变量（`TRANSCRIPT_PROVIDER_CHAIN=api,yt_dlp`，并配置对应 API 或 Worker 中的 `yt-dlp`）

进程通过 SIGTERM / SIGINT 优雅停止。Worker 每 30～60 秒续租当前 Job，并写入 `worker_heartbeats`；清理任务只有在 Lease、Job heartbeat 和 Worker heartbeat 都超时后才恢复任务。部署平台的健康检查应独立于 Web。

本机常驻 Worker 使用 LaunchAgent：先创建权限为 `0600` 的 `.env.worker.local`，再运行 `npm run worker:install`。`npm run worker:status` 会回读 heartbeat、Job、AI runs、字幕和费用，不输出任何密钥。

## 4. 定时任务

V2 迁移为每个现有工作区建立北京时间计划：06:15 AIHot、06:20 YouTube、06:25 Get 笔记、06:30 Daily Brief。常驻 Worker 每 30 秒读取 `job_schedules`，只创建幂等 Job；Web 进程不承担后台调度。

## 5. 生产执行与检查清单

先备份，再在有 `DATABASE_URL` 的受控终端执行：

```bash
pg_dump "$DATABASE_URL" --format=custom --file=signal-desk-before-v2.dump
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608170002_signal_desk_v2.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608170003_signal_desk_reliable_daily.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608180001_signal_desk_concurrency.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202608180002_signal_desk_migration_audit.sql
```

Supabase SQL Editor 会把一次提交包装在事务中。执行 `003` 时必须先单独运行第一条 `alter type ... add value 'blocked'` 并确认成功，再运行该文件剩余部分；否则 PostgreSQL 会返回 `55P04 unsafe use of new value` 并回滚整次提交。

执行后检查：

```sql
select to_regclass('public.creator_content_analyses'),
       to_regclass('public.event_analyses'),
       to_regclass('public.content_versions'),
       to_regclass('public.worker_heartbeats');
select enumlabel from pg_enum join pg_type on pg_type.oid=enumtypid where typname='job_status' order by enumsortorder;
select job_type,cron_expression,timezone,next_run_at from public.job_schedules order by job_type;
select tablename,policyname from pg_policies where tablename in ('content_versions','worker_heartbeats','creator_content_analyses','event_analyses');
select indexname from pg_indexes where indexname in ('jobs_blocked_retry_idx','jobs_running_heartbeat_idx','creator_content_analyses_version_idx','event_analyses_version_idx');
select version,name,checksum_sha256,applied_at from public.signal_desk_migrations order by version;
```

最后用两个真实测试账号分别创建内容画像、用户状态和学习记录，确认互相查询为 0 条。

## 6. 回滚

生产执行前先在 staging 项目验证。`003` 会给现有表和枚举增加字段/状态并新增历史表，回滚优先恢复执行前备份；不要修改已经执行过的迁移文件，也不要在没有备份时手工删除生产字段。
