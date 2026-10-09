import type { Lead } from "@/lib/types";

const TIER_STYLE = {
  A: "bg-linear-to-br from-teal-400 to-emerald-500 text-slate-950 shadow-lg shadow-teal-500/30",
  B: "bg-amber-400/90 text-amber-950",
  C: "bg-slate-700 text-slate-300",
};

export function ScoreBadge({ score, tier, large }: { score: number | null; tier: Lead["tier"]; large?: boolean }) {
  const size = large ? "h-14 w-14 text-xl" : "h-9 w-9 text-sm";
  if (score === null || !tier) return <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-600 text-slate-500`}>—</span>;
  return (
    <span title={`Tier ${tier}`} className={`${size} ${TIER_STYLE[tier]} inline-flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums`}>
      {score}
    </span>
  );
}

// The few signals a searcher scans for, as compact chips.
export function SignalChips({ lead }: { lead: Lead }) {
  const s = lead.signals;
  const year = new Date().getFullYear();
  const chips: [string, string][] = [];
  if (lead.chain || s?.franchise) chips.push(["Chain / franchise", "bg-rose-500/10 text-rose-300 ring-rose-500/30"]);
  if (s?.foundedYear) chips.push([`Est. ${s.foundedYear}`, year - s.foundedYear >= 25 ? "bg-teal-500/10 text-teal-300 ring-teal-500/30" : "bg-slate-500/10 text-slate-300 ring-slate-500/30"]);
  if (s?.ownerOperated) chips.push(["Family-owned", "bg-teal-500/10 text-teal-300 ring-teal-500/30"]);
  if (s?.generational) chips.push(["Multi-gen", "bg-teal-500/10 text-teal-300 ring-teal-500/30"]);
  if (s?.succession) chips.push(["Retirement", "bg-teal-500/10 text-teal-300 ring-teal-500/30"]);
  if (s?.copyrightYear && s.copyrightYear <= year - 3) chips.push([`Site ©${s.copyrightYear}`, "bg-blue-500/10 text-blue-300 ring-blue-500/30"]);
  if (s && !s.reachable) chips.push([s.error ?? "No website", "bg-slate-500/10 text-slate-400 ring-slate-500/30"]);
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(([label, cls]) => (
        <span key={label} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>{label}</span>
      ))}
    </div>
  );
}
