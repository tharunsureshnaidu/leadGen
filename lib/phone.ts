// One display format for phones from OSM ("+1-512-375-0942;+1-737-..."), CSVs and websites.
export function formatPhone(raw?: string | null): string | null {
  const first = raw?.split(/[;,/]/)[0].trim();
  if (!first) return null;
  const d = first.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : first;
}
