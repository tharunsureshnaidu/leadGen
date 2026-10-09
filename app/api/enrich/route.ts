import { crawl, hasMx } from "@/lib/crawl";
import { db, getLead } from "@/lib/db";
import { extractSignals } from "@/lib/extract";
import { INDUSTRIES } from "@/lib/industries";
import { scoreLead } from "@/lib/score";

export const maxDuration = 60;

// One lead per call: the browser fans out a few at a time, so no request nears the serverless timeout.
export async function POST(req: Request) {
  const { id } = await req.json();
  const lead = await getLead(Number(id));
  if (!lead) return Response.json({ error: "Not found" }, { status: 404 });

  const signals = lead.domain ? await crawl(lead.domain) : extractSignals([]);
  if (lead.email && !signals.emails.some((e) => e.address === lead.email!.toLowerCase())) {
    signals.emails.push({ address: lead.email.toLowerCase(), mx: null });
  }
  // MX-verify every address, whether it came from the site, OSM or a CSV.
  for (const e of signals.emails) e.mx = await hasMx(e.address.split("@")[1]);
  const { score, tier, reasons } = scoreLead(signals, {
    recurring: !!(lead.industry && INDUSTRIES[lead.industry]?.recurring),
    chain: !!lead.chain,
    hasPhone: !!lead.phone,
  });
  await db.execute({
    sql: "UPDATE leads SET score = ?, tier = ?, reasons = ?, signals = ?, enriched_at = CURRENT_TIMESTAMP WHERE id = ?",
    args: [score, tier, JSON.stringify(reasons), JSON.stringify(signals), lead.id],
  });
  return Response.json(await getLead(lead.id));
}
