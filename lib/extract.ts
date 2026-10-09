import * as cheerio from "cheerio";
import type { Owner, Signals } from "./types.ts";

// Pure HTML -> signals. No network here so it stays unit-testable.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const US_PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const JUNK_EMAIL = /no-?reply|donotreply|^(privacy|abuse|webmaster|postmaster)@|\.(png|jpe?g|gif|svg|webp)$|sentry|wixpress|example\.(com|org)|domain\.com|yourname|@email\.com|godaddy|squarespace|u00/i;
const FOUNDED_RE = /\b(?:since|established|est\.?|founded|in business since|serving[^.]{0,40}since)\s*(?:in\s+)?((?:18|19|20)\d{2})\b/gi;
const YEARS_RE = /\b(\d{2,3})\+?\s+years\s+(?:of\s+)?(?:experience|in business|serving|of service)/gi;
const COPYRIGHT_RE = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi;
const TITLE = "(?:Owner|Co-Owner|Founder|Co-Founder|President|CEO|Proprietor|Principal)";
const NAME = "([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s(?:Mc|Mac|O')?[A-Z][a-zA-Z'-]+)";
const OWNER_AFTER = new RegExp(`${NAME}\\s*(?:,|–|—|-|\\||is the|is our)\\s*(?:the\\s)?(?:Owner\\s&\\s)?${TITLE}`, "g");
const OWNER_BEFORE = new RegExp(`\\b${TITLE}\\s*(?::|,|–|—|-)?\\s*${NAME}`, "g");
const NOT_A_NAME = /\b(Our|The|Us|Contact|About|Team|Home|Services?|Company|Inc|LLC|Read|More|Meet|Call|Today|Free|Group|Street|Avenue|Heating|Cooling|Plumbing|Electric)\b/;

// Inboxes that won't reach the owner.
export const ROLE_EMAIL = /^(careers|jobs|hr|recruit\w*|billing|accounts?|ar|ap|payroll|marketing|press)@/;

const nowYear = () => new Date().getFullYear();

// Cloudflare "email protection" hides addresses as hex XOR'd with the first byte.
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractSignals(pages: { url: string; html: string }[], domain?: string): Signals {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const owners = new Map<string, Owner>();
  const founded: number[] = [];
  const copyright: number[] = [];
  let text = "";
  let title: string | undefined;
  let description: string | undefined;
  let linkedin: string | undefined;
  let facebook: string | undefined;
  let onlineBooking = false;

  for (const { html } of pages) {
    const $ = cheerio.load(html);
    title ??= $("title").first().text().trim() || undefined;
    description ??= $('meta[name="description"]').attr("content")?.trim() || undefined;

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (href.startsWith("mailto:")) emails.add(decodeURIComponent(href.slice(7).split("?")[0]));
      else if (href.startsWith("tel:")) phones.add(href.slice(4));
      else if (/linkedin\.com\/(company|in)\//i.test(href)) linkedin ??= href;
      else if (/facebook\.com\/(?!sharer|share|dialog)/i.test(href)) facebook ??= href;
      if (/\/cdn-cgi\/l\/email-protection#/.test(href)) emails.add(decodeCfEmail(href.split("#")[1]));
    });
    $("[data-cfemail]").each((_, el) => { emails.add(decodeCfEmail($(el).attr("data-cfemail")!)); });
    if (/calendly|servicetitan|housecallpro|jobber|book online|schedule online|online booking|add to cart|shopify/i.test(html)) onlineBooking = true;

    $("script, style, noscript, svg").remove();
    const pageText = $("body").text().replace(/\s+/g, " ");
    text += " " + pageText;
    for (const m of pageText.matchAll(COPYRIGHT_RE)) copyright.push(+m[1]);
    for (const re of [OWNER_AFTER, OWNER_BEFORE]) {
      for (const m of pageText.matchAll(re)) {
        const name = m[1].trim();
        if (NOT_A_NAME.test(name) || owners.has(name)) continue;
        const t = m[0].match(new RegExp(TITLE, "i"));
        owners.set(name, { name, title: t ? t[0] : "Owner" });
      }
    }
  }

  for (const m of text.matchAll(EMAIL_RE)) emails.add(m[0]);
  for (const m of text.matchAll(US_PHONE_RE)) phones.add(m[0]);
  for (const m of text.matchAll(FOUNDED_RE)) founded.push(+m[1]);
  for (const m of text.matchAll(YEARS_RE)) founded.push(nowYear() - +m[1]);

  const cleanEmails = [...emails]
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e));
  // Best contact first: own domain (not the web agency), and personal/general inboxes over HR/billing ones.
  const rank = (e: string) =>
    (domain && e.endsWith("@" + domain) ? 0 : 2) + (ROLE_EMAIL.test(e) ? 1 : 0);
  cleanEmails.sort((a, b) => rank(a) - rank(b));

  const phoneByDigits = new Map<string, string>();
  for (const p of phones) {
    const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    const pretty = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p.trim();
    if (d.length >= 10 && d.length <= 13 && !phoneByDigits.has(d)) phoneByDigits.set(d, pretty);
  }

  const validYears = (ys: number[]) => ys.filter((y) => y >= 1850 && y <= nowYear());
  const lower = text.toLowerCase();

  return {
    reachable: pages.length > 0,
    pages: pages.map((p) => p.url),
    title,
    description,
    emails: [...new Set(cleanEmails)].slice(0, 5).map((address) => ({ address, mx: null })),
    phones: [...phoneByDigits.values()].slice(0, 3),
    linkedin,
    facebook,
    owners: [...owners.values()].slice(0, 3),
    foundedYear: validYears(founded).length ? Math.min(...validYears(founded)) : undefined,
    copyrightYear: validYears(copyright).length ? Math.max(...validYears(copyright)) : undefined,
    ownerOperated: /family[- ]owned|family[- ]operated|family business|locally owned|owner[- ]operated/.test(lower),
    generational: /\b(second|third|fourth|2nd|3rd|4th)[- ]generation\b/.test(lower),
    // Precise phrasing only: "retirement planning" is a service many firms sell, not an exit signal.
    succession: /\b(?:i am|i'm|we are|owner is|founder is) (?:retiring|planning to retire)\b|\bretiring (?:owner|founder)\b|business (?:is )?for sale|seeking (?:a )?(?:buyer|successor)/.test(lower),
    franchise: /\bfranchis(e|ing|ee)\b|independently owned and operated|locations nationwide|find a location near you/.test(lower),
    hiring: /now hiring|we'?re hiring|join our team|careers\b/.test(lower),
    onlineBooking,
  };
}
