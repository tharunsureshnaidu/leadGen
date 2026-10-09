"use client";

import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LeadDrawer from "@/components/LeadDrawer";
import { ScoreBadge, SignalChips } from "@/components/ui";
import { INDUSTRIES } from "@/lib/industries";
import type { Lead } from "@/lib/types";

type ListRow = { list: string; n: number };
type Filters = { q: string; tier: "all" | "A" | "B" | "C"; verified: boolean; hideChains: boolean; status: "all" | Lead["status"] };

const CONCURRENCY = 4;

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [ai, setAi] = useState(false);
  const [list, setList] = useState<string>("");
  const [industry, setIndustry] = useState("hvac");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState<"" | "discover" | "enrich">("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [filters, setFilters] = useState<Filters>({ q: "", tier: "all", verified: false, hideChains: true, status: "all" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (focus?: string) => {
    const data = await (await fetch("/api/leads")).json();
    setLeads(data.leads);
    setLists(data.lists);
    setAi(data.ai);
    setList((cur) => focus ?? (cur || data.lists[0]?.list || ""));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inList = useMemo(() => leads.filter((l) => !list || l.list === list), [leads, list]);
  const visible = useMemo(() => {
    const q = filters.q.toLowerCase();
    return inList
      .filter((l) => filters.tier === "all" || l.tier === filters.tier)
      .filter((l) => !filters.verified || l.signals?.emails.some((e) => e.mx))
      .filter((l) => !filters.hideChains || !(l.chain || l.signals?.franchise))
      .filter((l) => filters.status === "all" || l.status === filters.status)
      .filter((l) => !q || `${l.name} ${l.domain} ${l.city} ${l.signals?.owners.map((o) => o.name).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [inList, filters]);

  const stats = {
    total: inList.length,
    enriched: inList.filter((l) => l.enriched_at).length,
    tierA: inList.filter((l) => l.tier === "A").length,
    verified: inList.filter((l) => l.signals?.emails.some((e) => e.mx)).length,
  };
  const pending = inList.filter((l) => !l.enriched_at);
  const step = !inList.length ? 1 : pending.length ? 2 : 3;
  const open = leads.find((l) => l.id === openId);

  function patchLocal(updated: Lead) {
    setLeads((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
  }

  async function runDiscover(e: React.FormEvent) {
    e.preventDefault();
    setBusy("discover");
    setNotice(null);
    const res = await fetch("/api/discover", { method: "POST", body: JSON.stringify({ industry, place }) });
    const data = await res.json();
    setBusy("");
    if (!res.ok) return setNotice({ kind: "err", text: data.error });
    setNotice({ kind: "ok", text: `Found ${data.received} businesses · ${data.added} new · ${data.duplicates} already known (merged)` });
    await load(data.list);
  }

  function importCsv(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: async ({ data }) => {
        const pick = (r: Record<string, string>, keys: string[]) => keys.map((k) => r[k]).find((v) => v?.trim())?.trim() ?? null;
        const rows = data.map((r) => ({
          name: pick(r, ["company", "company name", "name", "business", "business name", "account name"]) ?? pick(r, ["website", "domain", "url"]),
          website: pick(r, ["website", "website url", "domain", "url", "site"]),
          phone: pick(r, ["phone", "phone number", "telephone"]),
          email: pick(r, ["email", "email address"]),
          city: pick(r, ["city", "location"]),
          address: pick(r, ["address", "street"]),
          industry: null,
        }));
        const res = await fetch("/api/discover", { method: "POST", body: JSON.stringify({ rows, list: `CSV · ${file.name}` }) });
        const out = await res.json();
        if (!res.ok) return setNotice({ kind: "err", text: out.error });
        setNotice({ kind: "ok", text: `Imported ${out.received} rows · ${out.added} new · ${out.duplicates} duplicates merged` });
        await load(out.list);
      },
    });
  }

  // Enrich the selection if there is one (SaaSquatch's "only enrich the leads you want"), else everything pending.
  const enrichTargets = selected.size ? inList.filter((l) => selected.has(l.id)) : pending;

  async function enrich() {
    const queue = enrichTargets.map((l) => l.id);
    setBusy("enrich");
    setProgress({ done: 0, total: queue.length });
    // Small worker pool: steady progress, polite to target sites, no long-running request.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          const res = await fetch("/api/enrich", { method: "POST", body: JSON.stringify({ id }) }).catch(() => null);
          if (res?.ok) patchLocal(await res.json());
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }),
    );
    setBusy("");
  }

  async function setStatus(ids: number[], status: Lead["status"]) {
    setLeads((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, status } : l)));
    await fetch("/api/leads", { method: "PATCH", body: JSON.stringify({ ids, status }) });
  }

  function exportCsv(format: "full" | "hubspot") {
    const rows = (selected.size ? visible.filter((l) => selected.has(l.id)) : visible).map((l) => {
      const s = l.signals;
      const owner = s?.owners[0];
      const email = s?.emails.find((e) => e.mx) ?? s?.emails[0];
      const phone = l.phone ?? s?.phones[0] ?? "";
      const why = (l.reasons ?? []).filter((r) => r.points > 0).map((r) => r.text).join("; ");
      if (format === "hubspot") {
        const [first, ...last] = (owner?.name ?? "").split(" ");
        return {
          "First Name": first, "Last Name": last.join(" "), "Job Title": owner?.title ?? "", Email: email?.address ?? "",
          "Phone Number": phone, "Company Name": l.name, "Website URL": l.website ?? "", City: l.city ?? "",
          Industry: l.industry ? INDUSTRIES[l.industry]?.label : "", "Lead Status": l.status === "contacted" ? "IN_PROGRESS" : "NEW",
          "Acquisition Fit Score": l.score ?? "", Notes: why,
        };
      }
      return {
        Company: l.name, "Fit Score": l.score ?? "", Tier: l.tier ?? "", Owner: owner?.name ?? "", "Owner Title": owner?.title ?? "",
        Email: email?.address ?? "", "Email Verified": email?.mx ? "yes" : "no", Phone: phone, Website: l.website ?? "",
        Address: l.address ?? "", City: l.city ?? "", Founded: s?.foundedYear ?? "", LinkedIn: s?.linkedin ?? "",
        Status: l.status, "Why it fits": why, "AI Opener": l.opener ?? "",
      };
    });
    const blob = new Blob([Papa.unparse(rows)], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${(list || "leads").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}${format === "hubspot" ? "-hubspot" : ""}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const allChecked = visible.length > 0 && visible.every((l) => selected.has(l.id));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0b1120]/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-teal-400 to-blue-500 font-display text-sm font-extrabold text-slate-950">AF</div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-lg font-bold leading-tight text-white">
              Acquisition <span className="text-gradient">Fit</span>
            </div>
            <p className="truncate text-xs text-slate-400">A SaaSquatch Leads module · find owners likely to sell</p>
          </div>
          {lists.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="hidden text-slate-400 sm:inline">List</span>
              <select value={list} onChange={(e) => { setList(e.target.value); setSelected(new Set()); }} className="field max-w-[9rem] py-1.5 sm:max-w-[18rem]">
                {lists.map((l) => <option key={l.list} value={l.list}>{l.list} ({l.n})</option>)}
              </select>
            </label>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Find owners ready to <span className="text-gradient">sell</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Scrape independent businesses, enrich them from their own websites, and rank every lead by acquisition fit, with the reasons shown.
            </p>
          </div>
          <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium">
            {["Find", "Enrich & score", "Review & export"].map((label, i) => (
              <li key={label} className={`flex items-center gap-2 ${step === i + 1 ? "text-teal-300" : step > i + 1 ? "text-slate-400" : "text-slate-500"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step === i + 1 ? "bg-linear-to-r from-teal-500 to-blue-500 text-white" : step > i + 1 ? "bg-slate-700 text-teal-300" : "border border-slate-600"}`}>
                  {step > i + 1 ? "✓" : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>

        <section className="card p-5">
          <form onSubmit={runDiscover} className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-1.5 block font-medium text-slate-300">Industry</span>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="field w-full">
                {Object.entries(INDUSTRIES).map(([k, v]) => <option key={k} value={k}>{v.label}{v.recurring ? " · recurring revenue" : ""}</option>)}
              </select>
            </label>
            <label className="flex-1 text-sm">
              <span className="mb-1.5 block font-medium text-slate-300">City or region</span>
              <input value={place} onChange={(e) => setPlace(e.target.value)} required placeholder="e.g. Columbus, Ohio" className="field w-full" />
            </label>
            <button disabled={!!busy} className="btn-primary">
              {busy === "discover" ? "Scraping OpenStreetMap…" : "Scrape leads"}
            </button>
            <span className="hidden self-center text-xs text-slate-500 md:block">or</span>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className="btn-ghost py-2">
              Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
          </form>
          {notice && <p className={`mt-3 text-sm ${notice.kind === "err" ? "text-rose-400" : "text-teal-300"}`}>{notice.text}</p>}
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Leads in list", stats.total],
            ["Enriched", `${stats.enriched}/${stats.total}`],
            ["Tier A fits", stats.tierA],
            ["Verified emails", stats.verified],
          ].map(([label, value]) => (
            <div key={label} className="card px-4 py-3">
              <div className="text-xs font-medium text-slate-400">{label}</div>
              <div className="font-display text-2xl font-bold tabular-nums text-white">{value}</div>
            </div>
          ))}
        </section>

        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/60 p-3">
            <button onClick={enrich} disabled={!!busy || !enrichTargets.length} className="btn-primary py-1.5">
              {busy === "enrich"
                ? `Enriching ${progress.done}/${progress.total}…`
                : selected.size
                  ? `Enrich selected (${selected.size})`
                  : pending.length ? `Enrich & score ${pending.length}` : "All scored ✓"}
            </button>
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search name, owner, domain…"
              className="field w-52 py-1.5"
            />
            <div className="flex overflow-hidden rounded-lg border border-slate-600/70 text-sm" role="group" aria-label="Tier">
              {(["all", "A", "B", "C"] as const).map((t) => (
                <button key={t} onClick={() => setFilters({ ...filters, tier: t })} className={`px-2.5 py-1.5 ${filters.tier === t ? "bg-linear-to-r from-teal-500 to-blue-500 text-white" : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"}`}>
                  {t === "all" ? "All tiers" : t}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-slate-300">
              <input type="checkbox" className="accent-teal-500" checked={filters.verified} onChange={(e) => setFilters({ ...filters, verified: e.target.checked })} /> Verified email
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-300">
              <input type="checkbox" className="accent-teal-500" checked={filters.hideChains} onChange={(e) => setFilters({ ...filters, hideChains: e.target.checked })} /> Hide chains
            </label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })} className="field py-1.5">
              <option value="all">Any status</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="skip">Skipped</option>
            </select>
            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && (
                <>
                  <span className="text-sm text-slate-400">{selected.size} selected</span>
                  <button onClick={() => setStatus([...selected], "contacted")} className="btn-ghost">Mark contacted</button>
                </>
              )}
              <button onClick={() => exportCsv("full")} disabled={!visible.length} className="btn-ghost">Export CSV</button>
              <button onClick={() => exportCsv("hubspot")} disabled={!visible.length} className="btn-ghost border-teal-500/60 text-teal-300">HubSpot CSV</button>
            </div>
          </div>
          {busy === "enrich" && (
            <div className="h-1 bg-slate-800">
              <div className="h-1 bg-linear-to-r from-teal-400 to-blue-500 transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input type="checkbox" className="accent-teal-500" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((l) => l.id)))} />
                  </th>
                  <th className="px-3 py-2.5">Fit</th>
                  <th className="px-3 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Signals</th>
                  <th className="px-3 py-2.5">Owner</th>
                  <th className="px-3 py-2.5">Best contact</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {visible.map((l) => {
                  const email = l.signals?.emails.find((e) => e.mx) ?? l.signals?.emails[0];
                  const owner = l.signals?.owners[0];
                  return (
                    <tr key={l.id} onClick={() => setOpenId(l.id)} className={`cursor-pointer transition hover:bg-teal-500/5 ${l.status === "skip" ? "opacity-40" : ""} ${selected.has(l.id) ? "bg-teal-500/5" : ""}`}>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="accent-teal-500"
                          aria-label={`Select ${l.name}`}
                          checked={selected.has(l.id)}
                          onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                        />
                      </td>
                      <td className="px-3 py-2.5"><ScoreBadge score={l.score} tier={l.tier} /></td>
                      <td className="max-w-[16rem] px-3 py-2.5">
                        <div className="truncate font-medium text-slate-100">{l.name}</div>
                        <div className="truncate text-xs text-slate-400">{[l.domain, l.city].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="px-3 py-2.5"><SignalChips lead={l} /></td>
                      <td className="px-3 py-2.5 text-slate-200">{owner ? <>{owner.name}<div className="text-xs text-slate-400">{owner.title}</div></> : <span className="text-slate-600">—</span>}</td>
                      <td className="max-w-[14rem] px-3 py-2.5">
                        {email ? (
                          <div className="flex items-center gap-1.5 truncate text-slate-200">
                            <span className={email.mx ? "text-teal-400" : "text-slate-600"} title={email.mx ? "Mail server verified" : "Not verified"}>●</span>
                            <span className="truncate">{email.address}</span>
                          </div>
                        ) : null}
                        <div className="text-xs text-slate-400">{l.phone ?? l.signals?.phones[0] ?? (email ? "" : "—")}</div>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <select value={l.status} onChange={(e) => setStatus([l.id], e.target.value as Lead["status"])} className="field px-1.5 py-1 text-xs">
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="skip">Skip</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && (
              <div className="px-6 py-16 text-center text-sm text-slate-400">
                {inList.length
                  ? "No leads match these filters."
                  : "Pick an industry and a city to scrape independent businesses from OpenStreetMap, or import a CSV of companies you already have."}
              </div>
            )}
          </div>
        </section>

        <p className="text-center text-xs text-slate-500">
          Public business data only · OpenStreetMap directory · respects robots.txt · results cached 7 days
        </p>
      </main>

      {open && (
        <LeadDrawer
          lead={open}
          ai={ai}
          onClose={() => setOpenId(null)}
          onStatus={(st) => setStatus([open.id], st)}
          onUpdate={patchLocal}
        />
      )}
    </div>
  );
}
