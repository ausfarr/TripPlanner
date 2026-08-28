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

export interface ComposedStop {
  place_id: string;
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

const COMPOSE_TOOL: Anthropic.Tool = {
  name: "compose_itinerary",
  description: "Return the composed weekend itinerary, referencing only place_ids from the provided shortlist.",
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
                properties: {
                  place_id: { type: "string", description: "Must exactly match an id from the shortlist." },
                  time_slot: { type: "string", description: "e.g. 'morning', 'lunch', 'afternoon', 'dinner', 'evening'" },
                  blurb: { type: "string", description: "1-2 sentences on why this stop, and how it fits with the rest of the day." },
                },
                required: ["place_id", "time_slot", "blurb"],
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

function buildPrompt(input: WizardInput, days: CandidatesForDay[]): string {
  const dayBlocks = days
    .map((d) => {
      const weather = d.forecast
        ? `${d.forecast.tempMinF}-${d.forecast.tempMaxF}F, ${d.forecast.precipitationProbabilityMax}% chance of precip, ${d.forecast.isGoodOutdoorWeather ? "good for outdoor plans" : "better suited to indoor plans"}`
        : "forecast unavailable";
      const candidateList = d.candidates.map(describeCandidate).join("\n");
      return `### ${d.date}\nWeather: ${weather}\nCandidate places (choose only from this list):\n${candidateList || "(no eligible candidates found for this day)"}`;
    })
    .join("\n\n");

  return `You are planning a weekend for Austin and his girlfriend Jess in the NYC area (Manhattan, Queens, Brooklyn, Flushing, and out to Long Island — they have a car).

Constraints from their wizard answers:
- Scope: ${input.scope === "single" ? "a single outing" : "a full multi-day plan"}
- Budget ceiling: ${input.budget ? "$".repeat(input.budget) : "no limit specified"}
- Mood/vibe they want: ${input.mood.length ? input.mood.join(", ") : "no specific mood given"}
- Indoor/outdoor preference: ${input.indoorOutdoor}
- Getting around: ${input.transitPreference === "train_friendly" ? "train is fine" : input.transitPreference === "car_recommended" ? "prefers driving" : "either is fine"}

For each day below, select and sequence 1-3 stops (e.g. a meal plus an activity) from ONLY the
candidate places listed for that day. Do not invent any place not in the list. Reason about
pairing (e.g. don't put two heavy meals back to back), timing, and travel sanity (don't
zig-zag across boroughs in one day), and about the listed weather. Write a short blurb per
stop and an overall summary. Call the compose_itinerary tool with your answer.

${dayBlocks}`;
}

export async function composeItinerary(
  input: WizardInput,
  days: CandidatesForDay[],
): Promise<ComposedItinerary> {
  const validIds = new Set(days.flatMap((d) => d.candidates.map((c) => c.id)));
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 2048,
    tools: [COMPOSE_TOOL],
    tool_choice: { type: "tool", name: "compose_itinerary" },
    messages: [{ role: "user", content: buildPrompt(input, days) }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a compose_itinerary tool call.");
  }

  const result = toolUse.input as ComposedItinerary;

  // Never trust the model to only cite real ids — filter server-side.
  const cleaned: ComposedItinerary = {
    summary: result.summary,
    days: result.days.map((d) => ({
      date: d.date,
      stops: d.stops.filter((s) => validIds.has(s.place_id)),
    })),
  };

  return cleaned;
}

const SWAP_TOOL: Anthropic.Tool = {
  name: "suggest_swap",
  description: "Suggest one replacement stop, referencing only a place_id from the provided shortlist.",
  input_schema: {
    type: "object",
    properties: {
      place_id: { type: "string" },
      blurb: { type: "string" },
    },
    required: ["place_id", "blurb"],
  },
};

export async function composeSwap(
  input: WizardInput,
  date: string,
  timeSlot: string,
  candidates: CandidatesForDay["candidates"],
  restOfDaySummary: string,
): Promise<ComposedStop> {
  const validIds = new Set(candidates.map((c) => c.id));
  const anthropic = getClient();

  const prompt = `Austin wants to swap out one stop in a weekend plan for ${date} (${timeSlot} slot).
Here's the rest of that day so the replacement fits reasonably: ${restOfDaySummary || "(no other stops yet)"}

Candidate replacements (choose only from this list):
${candidates.map(describeCandidate).join("\n")}

Wizard preferences: mood=${input.mood.join(", ") || "none"}, budget=${input.budget ? "$".repeat(input.budget) : "no limit"}, indoor/outdoor=${input.indoorOutdoor}, transit=${input.transitPreference}.

Call the suggest_swap tool with one replacement.`;

  const response = await anthropic.messages.create({
    model: env.anthropicModel,
    max_tokens: 512,
    tools: [SWAP_TOOL],
    tool_choice: { type: "tool", name: "suggest_swap" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a suggest_swap tool call.");
  }

  const result = toolUse.input as { place_id: string; blurb: string };
  if (!validIds.has(result.place_id)) {
    throw new Error("Claude suggested a place_id outside the candidate shortlist.");
  }

  return { place_id: result.place_id, time_slot: timeSlot, blurb: result.blurb };
}
