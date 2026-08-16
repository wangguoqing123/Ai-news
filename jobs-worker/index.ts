import pg from "pg";
import { randomUUID } from "node:crypto";
import { AIHotConnector } from "../lib/connectors/aihot";
import { nextJobStatus, nextRetryAt, type JobType } from "../lib/jobs";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the job worker");
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.WORKER_DB_POOL_SIZE ?? 5), ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
const workerId = `${process.env.WORKER_NAME ?? "signal-worker"}-${randomUUID().slice(0,8)}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 2000);

type ClaimedJob = { id: string; workspace_id: string; type: JobType; payload: Record<string, unknown>; attempt: number; max_attempts: number };

async function claimJob(): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<ClaimedJob>(`
      select id, workspace_id, type, payload, attempt, max_attempts
      from public.jobs
      where status='queued' and run_at <= now()
      order by priority desc, run_at asc
      for update skip locked
      limit 1
    `);
    const job = result.rows[0];
    if (!job) { await client.query("commit"); return null; }
    await client.query(`update public.jobs set status='running', locked_at=now(), locked_by=$2, lease_expires_at=now() + interval '5 minutes', attempt=attempt+1 where id=$1`, [job.id, workerId]);
    await client.query(`insert into public.job_attempts(workspace_id,job_id,attempt,worker_id,status) values($1,$2,$3,$4,'running')`, [job.workspace_id,job.id,job.attempt+1,workerId]);
    await client.query("commit");
    return { ...job, attempt: job.attempt + 1 };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function runJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  if (job.type === "sync_aihot") {
    const connector = new AIHotConnector();
    const page = await connector.fetchPage({ config: { baseUrl: "https://aihot.virxact.com/api/v1", mode: "selected", window: "24h", limit: 20 } });
    return { fetched: page.items.length, hasMore: page.hasMore };
  }
  if (job.type === "cleanup_expired_jobs") {
    const result = await pool.query(`update public.jobs set status='queued', locked_at=null, locked_by=null, lease_expires_at=null where status='running' and lease_expires_at < now() returning id`);
    return { recovered: result.rowCount ?? 0 };
  }
  throw new Error(`No handler registered for ${job.type}`);
}

async function completeJob(job: ClaimedJob, result: Record<string, unknown>) {
  await pool.query(`update public.jobs set status='succeeded', result=$2, locked_at=null, locked_by=null, lease_expires_at=null where id=$1`, [job.id,result]);
  await pool.query(`update public.job_attempts set status='succeeded', finished_at=now() where job_id=$1 and attempt=$2`, [job.id,job.attempt]);
}

async function failJob(job: ClaimedJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = nextJobStatus(job.attempt,job.max_attempts);
  const runAt = nextRetryAt(job.attempt);
  await pool.query(`update public.jobs set status=$2, run_at=$3, error=$4, locked_at=null, locked_by=null, lease_expires_at=null where id=$1`, [job.id,status,runAt,message]);
  await pool.query(`update public.job_attempts set status='failed', error=$3, finished_at=now() where job_id=$1 and attempt=$2`, [job.id,job.attempt,message]);
}

async function loop() {
  while (true) {
    const job = await claimJob();
    if (!job) { await new Promise((resolve) => setTimeout(resolve,pollMs)); continue; }
    try { await completeJob(job,await runJob(job)); } catch (error) { await failJob(job,error); }
  }
}

const shutdown = async () => { await pool.end(); process.exit(0); };
process.on("SIGTERM",shutdown); process.on("SIGINT",shutdown);
loop().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await pool.end(); process.exit(1); });
