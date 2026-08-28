import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";
import type { CandidatesForDay } from "./candidates.js";
import type { WizardInput } from "../types.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — itinerary generation is unavailable until it is.");
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

// A composed stop is EITHER an existing DB place (place_id set) OR a genuinely new
// suggestion surfaced via web search (name + source_url set) — never both, never neither.
// The "new" shape only gets this far if it survived the source_url check in cleanStops();
// routes/itinerary.ts is responsible for actually inserting it into `places` before it's
// persisted onto an outing, since anthropic.ts doesn't own DB writes.
export interface ComposedStop {
  place_id?: string;
  name?: string;
  category?: string;
  address?: string;
  notes?: string;
  source_url?: string;
  time_slot: string;
  blurb: string;
}

export interface ComposedDay {
  date: string;
  stops: ComposedStop[];
}

export interface ComposedItinerary {
  summary: string;
  days: ComposedDay[];
}

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20260209 = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
};

function describeCandidate(c: CandidatesForDay["candidates"][number]): string {
  const tags = [...(c.cuisine ?? []), ...(c.vibe ?? [])].join(", ") || "none";
  const priceStr = c.price_tier ? "$".repeat(c.price_tier) : "unknown price";
  return [
    `- id: ${c.id}`,
    `  name: ${c.name} (${c.category})`,
    `  tags: ${tags}`,
    `  price: ${priceStr}`,
    `  neighborhood: ${c.neighborhood ?? "unknown"}`,
    `  transit: ${c.transit_mode}`,
    `  status: ${c.status}`,
    c.notes ? `  notes: ${c.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// The "new suggestion" fields are only present when web search is enabled for this call —
// see buildPrompt's conditional instructions. Kept optional here (rather than a separate
// schema) so the existing-only path is unaffected when search is off.
const STOP_SCHEMA_PROPERTIES = {
  place_id: { type: "string", description: "Set this when picking from the shortlist. Must exactly match an id from it." },
  name: { type: "string", description: "Set this INSTEAD of place_id only for a genuinely new suggestion found via web search — a real place or event, not from the shortlist." },
  category: { type: "string", description: "Only with name: e.g. 'event', 'restaurant', 'activity'." },
  address: { type: "string", description: "Only with name, if known." },
  notes: { type: "string", description: "Only with name: any concrete details (dates, price, etc.) found via search." },
  source_url: { type: "string", description: "Only with name: REQUIRED — the real URL where you found this. Never fabricate one." },
  time_slot: { type: "string", description: "e.g. 'morning', 'lunch', 'afternoon', 'dinner', 'evening'" },
  blurb: { type: "string", description: "1-2 sentences on why this stop, and how it fits with the rest of the day." },
};

function composeTool(webSearchEnabled: boolean): Anthropic.Tool {
  return {
    name: "compose_itinerary",
    description: webSearchEnabled
      ? "Return the composed weekend itinerary. Each stop is either an existing place_id from the shortlist, or a new web-search-discovered suggestion (name + source_url)."
      : "Return the composed weekend itinerary, referencing only place_ids from the provided shortlist.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "A short natural-language overview of the whole plan." },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              stops: {
                type: "array",
                items: {
                  type: "object",
                  properties: STOP_SCHEMA_PROPERTIES,
                  required: ["time_slot", "blurb"],
                },
              },
            },
            required: ["date", "stops"],
          },
        },
      },
      required: ["summary", "days"],
    },
  };
}

function buildPreferenceBlock(preferenceSummary: string): string {
  if (!preferenceSummary) return "";
  return `\nGeneral preferences on record (not tied to any specific place — weigh these when choosing and when writing blurbs):\n${preferenceSummary}\n`;
}

function buildWebSearchInstructions(webSearchEnabled: boolean): string {
  if (!webSearchEnabled) return "";
  return `\nYou may ALSO search the web for what's genuinely happening this weekend — pop-ups,
seasonal events, limited-run exhibits, etc. — and suggest a stop that isn't in the
shortlist. Only do this for something real and current that you found via search, never
from general knowledge alone. Every such suggestion MUST include a real source_url from
your search results and MUST omit place_id. Don't force one in if the shortlist already
covers the day well — only add a new suggestion when it's a genuinely good, current fit.\n`;
}

function buildPrompt(
  input: WizardInput,
  days: CandidatesForDay[],
  preferenceSummary: string,
  webSearchEnabled: boolean,
): string {
  const dayBlocks = days
    .map((d) => {
      const weather = d.forecast
        ? `${d.forecast.tempMinF}-${d.forecast.tempMaxF}F, ${d.forecast.precipitationProbabilityMax}% chance of precip, ${d.forecast.isGoodOutdoorWeather ? "good for outdoor plans" : "better suited to indoor plans"}`
        : "forecast unavailable";
      const candidateList = d.candidates.map(describeCandidate).join("\n");
      return `### ${d.date}\nWeather: ${weather}\nCandidate places (choose from this list${webSearchEnabled ? ", or a new web-search suggestion — see below" : ""}):\n${candidateList || "(no eligible candidates found for this day)"}`;
    })
    .join("\n\n");

  return `You are planning a weekend for Austin and his girlfriend Jess in the NYC area (Manhattan, Queens, Brooklyn, Flushing, and out to Long Island — they have a car).

Constraints from their wizard answers:
- Scope: ${input.scope === "single" ? "a single outing" : "a full multi-day plan"}
- Budget ceiling: ${input.budget ? "$".repeat(input.budget) : "no limit specified"}
- Mood/vibe they want: ${input.mood.length ? input.mood.join(", ") : "no specific mood given"}
- Indoor/outdoor preference: ${input.indoorOutdoor}
- Getting around: ${input.transitPreference === "train_friendly" ? "train is fine" : input.transitPreference === "car_recommended" ? "prefers driving" : "either is fine"}
${buildPreferenceBlock(preferenceSummary)}
For each day below, select and sequence 1-3 stops (e.g. a meal plus an activity) from the
candidate places listed for that day. Do not invent any shortlist place that isn't in the
list. Reason about pairing (e.g. don't put two heavy meals back to back), timing, and travel
sanity (don't zig-zag across boroughs in one day), and about the listed weather. Write a
short blurb per stop and an overall summary.
${buildWebSearchInstructions(webSearchEnabled)}
Call the compose_itinerary tool with your answer${webSearchEnabled ? " once you're done searching (if you searched at all)" : ""}.

${dayBlocks}`;
}

// A stop is valid only if it's EITHER a real shortlist place_id OR a new suggestion with
// both a name and a source_url that looks like a real URL. Anything else is dropped —
// this is the anti-hallucination guarantee: an unsourced "new" stop is exactly the failure
// mode the whole shortlist-constrained design exists to prevent.
function cleanStops(stops: ComposedStop[], validIds: Set<string>): ComposedStop[] {
  return stops.filter((s) => {
    if (s.place_id) return validIds.has(s.place_id);
    if (s.name && s.source_url && /^https?:\/\//i.test(s.source_url)) return true;
    return false;
  });
}

function findComposeToolUse(content: Anthropic.ContentBlock[]): Anthropic.ToolUseBlock | undefined {
  return content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "compose_itinerary",
  );
}

export async function composeItinerary(
  input: WizardInput,
  days: CandidatesForDay[],
  preferenceSummary: string,
): Promise<ComposedItinerary> {
  const validIds = new Set(days.flatMap((d) => d.candidates.map((c) => c.id)));
  const anthropic = getClient();
  const webSearchEnabled = input.searchForEvents;

  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: webSearchEnabled ? 4096 : 2048,
    tools: webSearchEnabled ? [WEB_SEARCH_TOOL, composeTool(true)] : [composeTool(false)],
    // Forcing tool_choice to compose_itinerary would prevent Claude from ever calling
    // web_search first — only force it on the no-search path, where there's nothing else
    // for Claude to do anyway.
    tool_choice: webSearchEnabled ? { type: "auto" } : { type: "tool", name: "compose_itinerary" },
    messages: [{ role: "user", content: buildPrompt(input, days, preferenceSummary, webSearchEnabled) }],
  });

  const toolUse = findComposeToolUse(response.content);
  if (!toolUse) {
    throw new Error("Claude did not return a compose_itinerary tool call.");
  }

  const result = toolUse.input as ComposedItinerary;

  return {
    summary: result.summary,
    days: result.days.map((d) => ({
      date: d.date,
      stops: cleanStops(d.stops, validIds),
    })),
  };
}

function swapTool(webSearchEnabled: boolean): Anthropic.Tool {
  return {
    name: "suggest_swap",
    description: webSearchEnabled
      ? "Suggest one replacement stop: either a place_id from the shortlist, or a new web-search-discovered suggestion (name + source_url)."
      : "Suggest one replacement stop, referencing only a place_id from the provided shortlist.",
    input_schema: {
      type: "object",
      properties: STOP_SCHEMA_PROPERTIES,
      required: ["time_slot", "blurb"],
    },
  };
}

export async function composeSwap(
  input: WizardInput,
  date: string,
  timeSlot: string,
  candidates: CandidatesForDay["candidates"],
  restOfDaySummary: string,
  preferenceSummary: string,
): Promise<ComposedStop> {
  const validIds = new Set(candidates.map((c) => c.id));
  const anthropic = getClient();
  const webSearchEnabled = input.searchForEvents;

  const prompt = `Austin wants to swap out one stop in a weekend plan for ${date} (${timeSlot} slot).
Here's the rest of that day so the replacement fits reasonably: ${restOfDaySummary || "(no other stops yet)"}

Candidate replacements (choose from this list${webSearchEnabled ? ", or search the web for one new current idea — see below" : ""}):
${candidates.map(describeCandidate).join("\n")}

Wizard preferences: mood=${input.mood.join(", ") || "none"}, budget=${input.budget ? "$".repeat(input.budget) : "no limit"}, indoor/outdoor=${input.indoorOutdoor}, transit=${input.transitPreference}.
${buildPreferenceBlock(preferenceSummary)}${buildWebSearchInstructions(webSearchEnabled)}
Call the suggest_swap tool with one replacement${webSearchEnabled ? " once you're done searching (if you searched at all)" : ""}.`;

  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: webSearchEnabled ? 2048 : 512,
    tools: webSearchEnabled ? [WEB_SEARCH_TOOL, swapTool(true)] : [swapTool(false)],
    tool_choice: webSearchEnabled ? { type: "auto" } : { type: "tool", name: "suggest_swap" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "suggest_swap",
  );
  if (!toolUse) {
    throw new Error("Claude did not return a suggest_swap tool call.");
  }

  const result = toolUse.input as ComposedStop;
  const [cleaned] = cleanStops([result], validIds);
  if (!cleaned) {
    throw new Error("Claude's swap suggestion was neither a valid shortlist place_id nor a sourced new suggestion.");
  }

  return { ...cleaned, time_slot: timeSlot };
}
