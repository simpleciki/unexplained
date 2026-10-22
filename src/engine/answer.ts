// Structured answer for one question (no prose yet).
import type { Engine } from "./engine.ts";
import type { Flag } from "./types.ts";
import { asOfMs } from "./time.ts";
import type { SeatResolution } from "./seats.ts";
import { runDetectors } from "./detectors/index.ts";
import type { QuestionInput } from "./focus.ts";
import { focusOf } from "./focus.ts";

// Which topic and facets a question is about. A model step in a real run; supplied by the caller.
export type Route = { topic: string; facets: string[] };

// route: the seat for the current decision; inEffectRoute: the seat that holds what applies on the date
// (differs for a partial replacement, e.g. an approval whose labor rate comes from a client price seat).
export type AnswerOptions = { route?: Route; inEffectRoute?: Route; clientExplanation?: "present" | "absent" };

export type Answer = {
  question_id: string;
  as_of: string | null;
  focus: { job: string | null; client: string | null; quote: string | null; invoice: string | null };
  seats: (Omit<SeatResolution, "coexisting" | "conflicts" | "scheduled"> & { reasons: string[] })[];
  current_card: string | null;
  in_effect_card: string | null;
  reasons: string[];
  flags: { pattern: string; evidence: string[]; details: Record<string, unknown> }[];
  checked: Flag[];
  unresolved: { seat: string; conflicts: SeatResolution["conflicts"] }[];
};

// Job scope first: the most specific seat answers, broader ones are fallbacks.
const specificity = (s: string) => (s.startsWith("job:") ? 0 : s.startsWith("client:") ? 1 : 2);

export function answerQuestion(engine: Engine, q: QuestionInput, opts: AnswerOptions = {}): Answer {
  const asOf = q.as_of ? asOfMs(q.as_of) : Number.POSITIVE_INFINITY;
  const focus = focusOf(q, asOf, engine.docs, engine.data);
  const scopes = [...q.seats].sort((a, b) => specificity(a) - specificity(b));
  const resolveRoute = (route?: Route) =>
    route
      ? scopes.flatMap((scope) =>
          route.facets.map((facet) => engine.graph.resolve({ topic: route.topic, facet, scope }, Number.isFinite(asOf) ? asOf : undefined)),
        )
      : [];
  const resolved = resolveRoute(opts.route);
  const sameRoute = !opts.inEffectRoute || JSON.stringify(opts.inEffectRoute) === JSON.stringify(opts.route);
  const effectSeats = sameRoute ? resolved : resolveRoute(opts.inEffectRoute);
  if (!sameRoute) resolved.push(...effectSeats);
  const found = resolved.filter((r) => r.current_card);
  const checked = runDetectors(
    {
      data: engine.data,
      docs: engine.docs,
      graph: engine.graph,
      cards: engine.cards,
      vocab: engine.vocab,
      asOf,
      job: focus.job,
      client: focus.client,
      focusQuote: focus.quote,
      focusInvoice: focus.invoice,
      invoiceQuestion: focus.invoiceQuestion,
      clientExplanation: opts.clientExplanation,
    },
    found,
    scopes,
  );
  const fired = checked.filter((f) => f.fired);
  const seatReasons = (r: SeatResolution) =>
    [r.current_card, r.in_effect_card, ...r.chain, ...r.coexisting].filter((x): x is string => !!x);
  const isCard = (id: string) => engine.graph.cards.has(id) || engine.cards.some((c) => c.card_id === id);
  const reasons = [
    ...new Set([...found.flatMap(seatReasons), ...fired.flatMap((f) => f.evidence.filter(isCard)), ...checked.flatMap((f) => f.support ?? [])]),
  ];
  return {
    question_id: q.question_id,
    as_of: q.as_of,
    focus: { job: focus.job, client: focus.client, quote: focus.quote?.quote_id ?? null, invoice: focus.invoice?.invoice_id ?? null },
    seats: resolved.map((full) => {
      const { coexisting: _c, conflicts: _x, scheduled: _s, ...r } = full;
      return { ...r, reasons: seatReasons(full) };
    }),
    current_card: found[0]?.current_card ?? null,
    in_effect_card: effectSeats.find((r) => r.in_effect_card)?.in_effect_card ?? null,
    reasons,
    flags: fired.map((f) => ({ pattern: f.pattern, evidence: f.evidence, details: f.details })),
    checked,
    unresolved: resolved.filter((r) => r.conflicts.length).map((r) => ({ seat: `${r.seat.topic}|${r.seat.facet}|${r.scope_used}`, conflicts: r.conflicts })),
  };
}
