export async function GET() {
  return Response.json({
    ok: true,
    service: "signal-desk-web",
    mode: process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "demo",
    time: new Date().toISOString(),
  });
}
