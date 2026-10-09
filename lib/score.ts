import { ROLE_EMAIL } from "./extract.ts";
import type { Reason, Signals } from "./types.ts";

// Acquisition-fit = how likely this owner is to sell AND how reachable they are.
// Weights are a transparent heuristic; every point shows up as a reason in the UI.
export function scoreLead(
  s: Signals,
  ctx: { recurring?: boolean; chain?: boolean; hasPhone?: boolean; year?: number },
): { score: number; tier: "A" | "B" | "C"; reasons: Reason[] } {
  const year = ctx.year ?? new Date().getFullYear();
  const r: Reason[] = [];
  const add = (points: number, text: string) => r.push({ points, text });

  if (s.foundedYear) {
    const age = year - s.foundedYear;
    if (age >= 25) add(25, `Est. ${s.foundedYear} (${age} yrs) — founder likely near retirement`);
    else if (age >= 15) add(15, `Est. ${s.foundedYear} (${age} yrs) — mature, proven business`);
    else if (age >= 8) add(5, `Est. ${s.foundedYear} (${age} yrs) — established`);
    else add(-5, `Est. ${s.foundedYear} — young business, owner unlikely to exit`);
  }
  if (s.ownerOperated) add(10, "Family / owner-operated — the owner is the decision maker");
  if (s.generational) add(5, "Multi-generation — succession is already a live topic");
  if (s.succession) add(10, "Mentions retirement / succession");
  if (s.owners.length) add(10, `Owner identified: ${s.owners[0].name} (${s.owners[0].title})`);

  const verified = s.emails.find((e) => e.mx);
  if (verified && !ROLE_EMAIL.test(verified.address)) add(15, `Deliverable email (MX verified): ${verified.address}`);
  else if (verified) add(5, `Only a department inbox (${verified.address}) — owner email still needed`);
  else if (s.emails.some((e) => e.mx === null)) add(5, "Email found (mail server not verifiable)");
  else if (s.emails.length) add(0, "Email domain has no mail server — likely to bounce");
  if (s.phones.length || ctx.hasPhone) add(5, "Direct phone number");

  if (s.copyrightYear && s.copyrightYear <= year - 3) add(10, `Website last updated ~${s.copyrightYear} — digital/AI upside post-acquisition`);
  if (s.reachable && !s.onlineBooking) add(5, "No online booking — operational upside");
  if (ctx.recurring) add(10, "Recurring-revenue vertical");
  if (s.hiring) add(5, "Hiring — healthy demand");
  if (s.franchise || ctx.chain) add(-35, "Franchise / chain — not an independent seller");
  if (s.error?.startsWith("domain parked")) add(-20, "Website domain is parked — business may have closed");
  else if (!s.reachable) add(0, s.error ? `Website not readable (${s.error})` : "No website — scored on directory data only");

  const score = Math.max(0, Math.min(100, r.reduce((a, b) => a + b.points, 0)));
  return { score, tier: score >= 65 ? "A" : score >= 40 ? "B" : "C", reasons: r };
}
