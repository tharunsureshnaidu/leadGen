import { discover, upsertLeads, type RawLead } from "@/lib/discover";
import { INDUSTRIES } from "@/lib/industries";

export const maxDuration = 60;

// Either {industry, place} for OSM discovery or {rows, list} for a CSV import — both share dedupe + upsert.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    if (Array.isArray(body.rows)) {
      const rows: RawLead[] = body.rows.slice(0, 2000).map((r: Record<string, string>) => ({ ...r, name: String(r.name ?? "") }));
      return Response.json({ list: body.list, ...(await upsertLeads(String(body.list), rows)) });
    }
    const industry = String(body.industry);
    const place = String(body.place ?? "").trim();
    if (!INDUSTRIES[industry] || !place) return Response.json({ error: "Pick an industry and a location" }, { status: 400 });
    const list = `${INDUSTRIES[industry].label} · ${place}`;
    return Response.json({ list, ...(await upsertLeads(list, await discover(industry, place))) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Discovery failed" }, { status: 502 });
  }
}
