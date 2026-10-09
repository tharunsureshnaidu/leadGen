import { cached, db, HOUR, init } from "./db.ts";
import { INDUSTRIES } from "./industries.ts";

export const UA = "AcquisitionFitLeads/1.0 (lead research; respects robots.txt)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

export type RawLead = {
  name: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  industry?: string | null;
  chain?: boolean;
};

export function domainOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    // A deep link (e.g. a member page on an association site) isn't the company's own domain.
    if (u.pathname.split("/").filter(Boolean).length >= 2) return null;
    // Social/marketplace pages aren't the company's own site.
    if (!host.includes(".") || /facebook|instagram|yelp|google|linkedin|twitter|x\.com|nextdoor|angi\.com/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

// Same business from two sources (or twice in one) collapses to one row.
export function dedupeKey(l: RawLead): string {
  const domain = domainOf(l.website);
  if (domain) return domain;
  const name = l.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(inc|llc|ltd|co|corp|company)$/, "");
  return `${name}|${(l.phone ?? "").replace(/\D/g, "").slice(-10) || (l.city ?? "").toLowerCase()}`;
}

async function geocode(place: string) {
  return cached(`geo:${place.toLowerCase()}`, async () => {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`, {
      headers: { "User-Agent": UA },
    });
    const [hit] = await res.json();
    if (!hit) throw new Error(`Couldn't find "${place}"`);
    const [s, n, w, e] = hit.boundingbox.map(Number);
    // City limits are tight; pad ~10km so suburbs (where many trades sit) are included.
    const pad = 0.1;
    return { bbox: [s - pad, w - pad, n + pad, e + pad].map((v) => +v.toFixed(4)), label: String(hit.display_name).split(",").slice(0, 2).join(",") };
  });
}

type OsmEl = { tags?: Record<string, string> };

async function overpass(query: string): Promise<OsmEl[]> {
  // Public Overpass servers often answer 429/504 under load; a short backoff usually gets through.
  const deadline = Date.now() + 50_000; // stay inside the 60s function limit
  let lastErr: unknown;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": UA }, signal: AbortSignal.timeout(Math.min(25_000, deadline - Date.now())) });
      if (res.ok) return (await res.json()).elements;
      lastErr = new Error(`OpenStreetMap is busy (HTTP ${res.status}) — try again in a minute`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
  }
  throw lastErr;
}

export async function discover(industry: string, place: string): Promise<RawLead[]> {
  const ind = INDUSTRIES[industry];
  if (!ind) throw new Error("Unknown industry");
  const { bbox, label } = await geocode(place);
  const box = bbox.join(",");
  const query = `[out:json][timeout:25];(${ind.osm.map((f) => `nwr${f}["name"](${box});`).join("")});out center tags 300;`;
  const els = await cached(`osm:${industry}:${box}`, () => overpass(query), 24 * HOUR);
  return els.map(({ tags = {} }) => ({
    name: tags.name,
    website: tags.website ?? tags["contact:website"] ?? tags.url ?? null,
    phone: tags.phone ?? tags["contact:phone"] ?? null,
    email: tags.email ?? tags["contact:email"] ?? null,
    address: [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
    city: tags["addr:city"] ?? label.split(",")[0],
    industry,
    // OSM `brand` tags mark chains/franchises — a free, high-precision signal.
    chain: !!(tags.brand || tags["brand:wikidata"]),
  }));
}

export async function upsertLeads(list: string, leads: RawLead[]) {
  await init();
  // Same name 3+ times in one area = chain, even without an OSM brand tag.
  const nameCount = new Map<string, number>();
  for (const l of leads) nameCount.set(l.name?.toLowerCase(), (nameCount.get(l.name?.toLowerCase()) ?? 0) + 1);
  const unique = new Map<string, RawLead>();
  for (const l of leads) {
    if (!l.name?.trim()) continue;
    if ((nameCount.get(l.name.toLowerCase()) ?? 0) >= 3) l.chain = true;
    unique.set(dedupeKey(l), unique.get(dedupeKey(l)) ?? l);
  }
  const before = Number((await db.execute("SELECT COUNT(*) AS n FROM leads")).rows[0].n);
  await db.batch(
    [...unique].map(([key, l]) => ({
      // On conflict keep what we have and only fill blanks: a re-import never clobbers enrichment or status.
      sql: `INSERT INTO leads (dedupe_key, list, name, industry, domain, website, phone, email, address, city, chain)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedupe_key) DO UPDATE SET list = excluded.list,
              website = COALESCE(leads.website, excluded.website), phone = COALESCE(leads.phone, excluded.phone),
              email = COALESCE(leads.email, excluded.email), address = COALESCE(leads.address, excluded.address),
              chain = MAX(leads.chain, excluded.chain)`,
      args: [key, list, l.name.trim(), l.industry ?? null, domainOf(l.website), l.website ?? null, l.phone ?? null, l.email ?? null, l.address ?? null, l.city ?? null, l.chain ? 1 : 0],
    })),
    "write",
  );
  const after = Number((await db.execute("SELECT COUNT(*) AS n FROM leads")).rows[0].n);
  return { received: leads.length, added: after - before, duplicates: leads.length - (after - before) };
}
