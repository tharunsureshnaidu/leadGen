import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { db, getLead } from "@/lib/db";

export const maxDuration = 60;

// Claude on Amazon Bedrock. Sonnet 5.5: strong writing at ~half Opus cost (~$0.005 per opener).
// Auth: AWS_BEARER_TOKEN_BEDROCK (Bedrock API key) or the standard AWS credential chain.
const MODEL = "anthropic.claude-sonnet-5-5";
let client: AnthropicBedrockMantle | undefined;

export async function POST(req: Request) {
  if (!process.env.BEDROCK_REGION) return Response.json({ error: "BEDROCK_REGION not set" }, { status: 501 });
  client ??= new AnthropicBedrockMantle({ awsRegion: process.env.BEDROCK_REGION });
  const lead = await getLead(Number((await req.json()).id));
  if (!lead?.signals) return Response.json({ error: "Enrich this lead first" }, { status: 400 });

  const s = lead.signals;
  const facts = {
    company: lead.name, city: lead.city, industry: lead.industry, website: lead.website,
    site_title: s.title, site_description: s.description, owner: s.owners[0], founded: s.foundedYear,
    family_owned: s.ownerOperated, multi_generation: s.generational, mentions_retirement: s.succession,
    why_it_fits: lead.reasons?.filter((r) => r.points > 0).map((r) => r.text),
  };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" }, // short copywriting; low effort keeps thinking tokens (and cost) down
      system:
        "You help acquisition entrepreneurs (search funds) write first-touch notes to small-business owners. " +
        "Tone: warm, respectful, plain-spoken, no hype, no flattery, never mention scraping or scores. " +
        "Use only the facts given; do not invent details.",
      messages: [{
        role: "user",
        content:
          `Facts about the business (JSON):\n${JSON.stringify(facts)}\n\n` +
          "Reply in exactly this format:\nSUMMARY: <one sentence on what the business does and why it is a good acquisition fit>\n" +
          "OPENER: <a 3-4 sentence cold email opener addressed to the owner by first name if known, expressing interest in learning about their business and their long-term plans, ending with a soft ask for a 15-minute call>",
      }],
    });
    if (res.stop_reason === "refusal") return Response.json({ error: "Model declined this request" }, { status: 422 });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    await db.execute({ sql: "UPDATE leads SET opener = ? WHERE id = ?", args: [text, lead.id] });
    return Response.json({ opener: text });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited — try again shortly" }, { status: 429 });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return Response.json({ error: "Bedrock rejected the credentials or model access" }, { status: 502 });
    if (e instanceof Anthropic.APIError) return Response.json({ error: `Bedrock error ${e.status}` }, { status: 502 });
    throw e;
  }
}
