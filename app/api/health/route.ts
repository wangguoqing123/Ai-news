export async function GET() {
  const demo=process.env.SIGNAL_DESK_DEMO_MODE === "true" || process.env.NEXT_PUBLIC_SIGNAL_DESK_DEMO_MODE === "true";
  const configured=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY);
  return Response.json({
    ok: true,
    service: "signal-desk-web",
    mode: demo ? "demo" : configured ? "supabase" : "unconfigured",
    time: new Date().toISOString(),
  });
}
