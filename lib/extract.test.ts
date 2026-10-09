import assert from "node:assert/strict";
import { test } from "node:test";
import { robotsAllows } from "./crawl.ts";
import { dedupeKey, domainOf } from "./discover.ts";
import { decodeCfEmail, extractSignals } from "./extract.ts";
import { scoreLead } from "./score.ts";

const HTML = `<html><head><title>Miller Heating & Air</title></head><body>
  <p>Family-owned and serving Columbus since 1984. Now a second-generation business.</p>
  <p>Meet our team: Tom Miller, Owner. Call (614) 555-0182.</p>
  <a href="mailto:tom@millerhvac.com">Email</a> <a href="mailto:logo@2x.png">x</a>
  <a href="https://www.linkedin.com/company/miller-hvac">in</a>
  <footer>© 2017 Miller Heating</footer><script>var a="x@sentry.io"</script></body></html>`;

test("extractSignals pulls succession + contact signals", () => {
  const s = extractSignals([{ url: "https://millerhvac.com", html: HTML }], "millerhvac.com");
  assert.equal(s.foundedYear, 1984);
  assert.equal(s.copyrightYear, 2017);
  assert.ok(s.ownerOperated && s.generational && !s.franchise);
  assert.deepEqual(s.owners, [{ name: "Tom Miller", title: "Owner" }]);
  assert.deepEqual(s.emails.map((e) => e.address), ["tom@millerhvac.com"]);
  assert.equal(s.phones.length, 1);
  assert.match(s.linkedin!, /linkedin/);
});

test("scoreLead ranks a retiring independent owner above a franchise", () => {
  const s = extractSignals([{ url: "https://x.com", html: HTML }], "millerhvac.com");
  s.emails[0].mx = true;
  const good = scoreLead(s, { recurring: true, year: 2026 });
  const chain = scoreLead(s, { recurring: true, chain: true, year: 2026 });
  assert.equal(good.tier, "A");
  assert.ok(chain.score <= good.score - 35);
  assert.equal(scoreLead(extractSignals([]), {}).tier, "C");
});

test("helpers", () => {
  assert.equal(decodeCfEmail("422f232b2e02273a232f322e276c212d2f"), "mail@example.com");
  assert.equal(domainOf("http://www.Foo.com/about"), "foo.com");
  assert.equal(domainOf("https://facebook.com/foo"), null);
  assert.equal(dedupeKey({ name: "Acme Plumbing LLC", phone: "+1 (614) 555-0100" }), dedupeKey({ name: "ACME Plumbing", phone: "614.555.0100" }));
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/"));
  assert.ok(robotsAllows("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin", "/about"));
});
