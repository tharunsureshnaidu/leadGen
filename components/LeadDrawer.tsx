"use client";

import { useState } from "react";
import type { Lead } from "@/lib/types";
import { ScoreBadge } from "./ui";

export default function LeadDrawer({
  lead, ai, onClose, onStatus, onUpdate,
}: {
  lead: Lead;
  ai: boolean;
  onClose: () => void;
  onStatus: (status: Lead["status"]) => void;
  onUpdate: (lead: Lead) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = lead.signals;

  async function draft() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/opener", { method: "POST", body: JSON.stringify({ id: lead.id }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error);
    onUpdate({ ...lead, opener: data.opener });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={lead.name}
        className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-700/60 bg-[#0f172a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-slate-700/60 bg-[#0f172a]/95 px-6 py-5 backdrop-blur">
          <ScoreBadge score={lead.score} tier={lead.tier} large />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-bold text-white">{lead.name}</h2>
            <p className="text-sm text-slate-400">
              {[lead.address, lead.city].filter(Boolean).join(", ") || "Address unknown"}
            </p>
            {lead.website && (
              <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" className="text-sm text-teal-300 hover:underline">
                {lead.domain ?? lead.website} ↗
              </a>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white">✕</button>
        </header>

        <div className="space-y-6 px-6 py-5">
          <div className="flex gap-2">
            {(["new", "contacted", "skip"] as const).map((st) => (
              <button
                key={st}
                onClick={() => onStatus(st)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${lead.status === st ? "border-transparent bg-linear-to-r from-teal-500 to-blue-500 text-white" : "border-slate-600 text-slate-300 hover:bg-slate-800"}`}
              >
                {st}
              </button>
            ))}
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Why this score</h3>
            {lead.reasons ? (
              <ul className="space-y-1.5">
                {lead.reasons.map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`w-10 shrink-0 text-right font-mono font-semibold ${r.points > 0 ? "text-teal-300" : r.points < 0 ? "text-rose-400" : "text-slate-500"}`}>
                      {r.points > 0 ? `+${r.points}` : r.points || "·"}
                    </span>
                    <span className="text-slate-200">{r.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Not enriched yet — run “Enrich & score”.</p>
            )}
          </section>

          {s && (
            <section className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Owner">
                {s.owners.length ? s.owners.map((o) => <div key={o.name}>{o.name} <span className="text-slate-500">· {o.title}</span></div>) : "—"}
              </Field>
              <Field label="Founded">{s.foundedYear ?? "—"}</Field>
              <Field label="Emails">
                {s.emails.length ? s.emails.map((e) => (
                  <div key={e.address} className="flex items-center gap-1.5">
                    <span className={e.mx ? "text-teal-400" : "text-slate-600"} title={e.mx ? "Mail server verified" : "Not verified"}>●</span>
                    <a href={`mailto:${e.address}`} className="truncate hover:underline">{e.address}</a>
                  </div>
                )) : "—"}
              </Field>
              <Field label="Phones">{[lead.phone, ...s.phones].filter(Boolean).slice(0, 3).map((p) => <div key={p}>{p}</div>)}</Field>
              <Field label="Social">
                {s.linkedin && <a className="block text-teal-300 hover:underline" href={s.linkedin} target="_blank" rel="noreferrer">LinkedIn ↗</a>}
                {s.facebook && <a className="block text-teal-300 hover:underline" href={s.facebook} target="_blank" rel="noreferrer">Facebook ↗</a>}
                {!s.linkedin && !s.facebook && "—"}
              </Field>
              <Field label="Pages read">{s.pages.length ? s.pages.map((p) => <div key={p} className="truncate text-slate-400">{new URL(p).pathname}</div>) : s.error ?? "—"}</Field>
              {s.description && <div className="col-span-2"><Field label="Site description">{s.description}</Field></div>}
            </section>
          )}

          {ai && s && (
            <section className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-300">AI outreach draft</h3>
                <div className="flex gap-2">
                  {lead.opener && (
                    <button onClick={() => navigator.clipboard.writeText(lead.opener!.replace(/^[\s\S]*OPENER:\s*/, ""))} className="text-xs font-medium text-teal-300 hover:underline">Copy</button>
                  )}
                  <button onClick={draft} disabled={busy} className="rounded-md bg-linear-to-r from-teal-500 to-blue-500 px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                    {busy ? "Writing…" : lead.opener ? "Regenerate" : "Draft opener"}
                  </button>
                </div>
              </div>
              {err && <p className="text-sm text-rose-400">{err}</p>}
              {lead.opener ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {lead.opener.replace(/^SUMMARY:\s*/m, "").replace(/^OPENER:\s*/m, "\n")}
                </p>
              ) : (
                <p className="text-sm text-slate-400">A personalised first-touch note to the owner, grounded only in the signals above.</p>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-xs font-medium text-slate-500">{label}</div>
      <div className="text-slate-200">{children}</div>
    </div>
  );
}
