import { db, init, toLead } from "@/lib/db";

export async function GET() {
  await init();
  const [leads, lists] = await Promise.all([
    db.execute("SELECT * FROM leads ORDER BY score IS NULL, score DESC, name LIMIT 5000"),
    db.execute("SELECT list, COUNT(*) AS n, MAX(created_at) AS at FROM leads GROUP BY list ORDER BY at DESC"),
  ]);
  return Response.json({ leads: leads.rows.map(toLead), lists: lists.rows, ai: !!process.env.BEDROCK_REGION });
}

export async function PATCH(req: Request) {
  const { ids, status } = await req.json();
  if (!["new", "contacted", "skip"].includes(status) || !Array.isArray(ids)) return Response.json({ error: "Bad request" }, { status: 400 });
  await init();
  await db.batch(ids.map((id: number) => ({ sql: "UPDATE leads SET status = ? WHERE id = ?", args: [status, Number(id)] })), "write");
  return Response.json({ ok: true });
}
