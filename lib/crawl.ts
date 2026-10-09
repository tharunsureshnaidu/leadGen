import { resolveMx } from "node:dns/promises";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import * as cheerio from "cheerio";
import { cached, HOUR, WEEK } from "./db.ts";
import { UA } from "./discover.ts";
import { extractSignals } from "./extract.ts";
import type { Signals } from "./types.ts";

// Node's happy-eyeballs default (250ms per address family) times out on many small-business hosts.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

const MAX_BYTES = 1_500_000;
const PARKED_RE = /hugedomains|\bsedo\.com|\bdan\.com|afternic|godaddy\.com\/domain|parkingcrew|bodis|domain is for sale|this domain (may be|is) for sale/i;
// Pages most likely to name the owner, the founding year and contact details.
const SUBPAGE_RE = /about|our-?story|history|team|staff|owner|leadership|who-?we-?are|contact/i;

async function get(url: string, timeout = 8000): Promise<{ url: string; html: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return { url: res.url, html: (await res.text()).slice(0, MAX_BYTES) };
  } catch {
    return null;
  }
}

// Minimal robots.txt: honour Disallow rules in the `User-agent: *` group.
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  const disallow: string[] = [];
  for (const line of robots.split("\n")) {
    const [k, ...rest] = line.split("#")[0].split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k.trim())) applies = v === "*";
    else if (applies && /^disallow$/i.test(k.trim()) && v) disallow.push(v);
  }
  return !disallow.some((d) => path.startsWith(d));
}

export async function hasMx(domain: string): Promise<boolean | null> {
  return cached(`mx:${domain}`, () =>
    Promise.race([
      resolveMx(domain).then((r) => r.length > 0, () => false),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]),
  );
}

export async function crawl(domain: string): Promise<Signals> {
  return cached(`site:${domain}`, async () => {
    const robotsTxt = await fetch(`https://${domain}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.text() : ""), () => "");
    if (!robotsAllows(robotsTxt, "/")) return { ...extractSignals([]), error: "blocked by robots.txt" };

    const home = (await get(`https://${domain}`)) ?? (await get(`http://${domain}`));
    if (!home) return { ...extractSignals([]), error: "site unreachable" };
    if (PARKED_RE.test(home.url) || PARKED_RE.test(home.html.slice(0, 20000))) return { ...extractSignals([]), error: "domain parked — business may have closed" };

    const $ = cheerio.load(home.html);
    const links = new Set<string>();
    $("a[href]").each((_, el) => {
      try {
        const u = new URL($(el).attr("href")!, home.url);
        if (u.hostname.replace(/^www\./, "") === domain && SUBPAGE_RE.test(u.pathname) && robotsAllows(robotsTxt, u.pathname)) links.add(u.origin + u.pathname);
      } catch {}
    });
    const sub = (await Promise.all([...links].slice(0, 3).map((u) => get(u)))).filter((p) => p !== null);

    return extractSignals([home, ...sub], domain);
  }, (s) => (s.error === "site unreachable" ? HOUR : WEEK)); // transient failures retry sooner
}
