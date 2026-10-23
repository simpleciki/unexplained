// Router: which job/client a question is about, which topic and facets, and the as-of date.
// Gate: unknown seat keys are dropped; with nothing left the answer is NOT_FOUND.
import { parsePhrase } from "../engine/timephrase.ts";
import type { ModelClient } from "../llm/client.ts";
import { obj, str, strArr } from "../llm/json.ts";
import type { AgentContext } from "./shared.ts";
import { RULES, vocabText } from "./shared.ts";

export type RouteResult = {
  question_type: string;
  seats: string[];
  topic: string | null;
  facets: string[];
  as_of: string | null;
  dropped: string[];
  status: "OK" | "NOT_FOUND";
};

const SYSTEM = `You route a question from a repair contractor's office gatekeeper to the records it is about.
Pick the job (job:<id>) and/or client (client:<id>) it concerns, the topic and facets that hold the answer,
and the date the question is asked about if it names one.
Rules:
${RULES}
Return JSON only: {"question_type":"send_check|why_rejected|invoice_check|rule_check|rate_check|other",
"seats":["job:<id>","client:<id>"],"topic":"...","facets":["..."],"as_of":"date phrase as written, or null"}`;

export async function route(
  client: ModelClient,
  model: string,
  question: string,
  ctx: AgentContext,
  asOfGiven: string | null,
): Promise<RouteResult> {
  const user = [
    `Question: ${question}`,
    asOfGiven ? `Asked as of: ${asOfGiven}` : "",
    `Jobs:\n${ctx.jobs.map((j) => `job:${j.id} (${j.trade}) "${j.title}" for client:${j.client}`).join("\n")}`,
    `Clients:\n${ctx.clients.map((c) => `client:${c.id} ${c.name}`).join("\n")}`,
    `Vocabulary:\n${vocabText(ctx.vocab)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await client.json(
    { stage: "answer", agent: "Router", model, system: SYSTEM, user },
    (v) => {
      const o = obj(v, "reply");
      return {
        question_type: typeof o.question_type === "string" ? o.question_type : "other",
        seats: strArr(o.seats, "seats"),
        topic: o.topic == null ? null : str(o.topic, "topic"),
        facets: o.facets == null ? [] : strArr(o.facets, "facets"),
        as_of: typeof o.as_of === "string" ? o.as_of : null,
      };
    },
    1,
  );
  const empty: RouteResult = { question_type: "other", seats: [], topic: null, facets: [], as_of: asOfGiven, dropped: [], status: "NOT_FOUND" };
  if (!r.value) return empty;
  const v = r.value;
  const seats = v.seats.filter((s) => ctx.vocab.scopes.has(s));
  const topic = v.topic && ctx.vocab.topics.has(v.topic) ? v.topic : null;
  const facets = v.facets.filter((f) => ctx.vocab.facets.has(f));
  const dropped = [...v.seats.filter((s) => !ctx.vocab.scopes.has(s)), ...v.facets.filter((f) => !ctx.vocab.facets.has(f))];
  // An as-of given by the caller wins; a phrase from the question is turned into a time by code.
  const as_of = asOfGiven ?? (v.as_of ? parsePhrase(v.as_of, "2026-06-26T23:59:00-05:00").iso : null);
  return { question_type: v.question_type, seats, topic, facets, as_of, dropped, status: seats.length && topic && facets.length ? "OK" : "NOT_FOUND" };
}
