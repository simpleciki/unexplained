// P4: client rules in force on the as-of date, checked against the focus submission.
import type { CheckedCard, Flag } from "../types.ts";
import { ms } from "../docs.ts";
import type { DetectCtx } from "./context.ts";
import { uniq } from "./context.ts";

type Rule =
  | { kind: "cap"; amount: number }
  | { kind: "recipients"; max: number }
  | { kind: "portal" }
  | { kind: "quiet"; businessDays: number }
  | { kind: "no_trip" };

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, seven: 7, ten: 10, fourteen: 14 };

// Reading a rule's meaning from its wording is a judgment; this covers the rule shapes in the data.
export function classifyRule(text: string): Rule | null {
  const t = text.toLowerCase();
  if (/\b(withdrawn|lifted|do not need|no longer)\b/.test(t) && !/may cc/.test(t)) return null;
  const cap = t.match(/(?:over|above|more than)\s*\$\s?([\d,]+)/);
  if (cap) return { kind: "cap", amount: Number(cap[1].replace(/,/g, "")) };
  if (/may cc/.test(t)) return { kind: "recipients", max: 2 };
  if (/only (to )?me|only me/.test(t)) return { kind: "recipients", max: 1 };
  if (/portal/.test(t) && /(do not|don't) email|not a submission/.test(t)) return { kind: "portal" };
  const quiet = t.match(/(?:reminder|nudge|ping)[^.]*?(\d+|one|two|three|five|seven|ten|fourteen) business days/);
  if (quiet) return { kind: "quiet", businessDays: WORDS[quiet[1]] ?? Number(quiet[1]) };
  if (/(do not|don't|no) (add )?trip (fee|line|charge)/.test(t)) return { kind: "no_trip" };
  return null;
}

function businessDaysBetween(a: number, b: number): number {
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// Every head on every client_rule seat for this client and job, as of asOf.
export function rulesInForce(ctx: DetectCtx): CheckedCard[] {
  const scopes = [ctx.client ? `client:${ctx.client}` : "", ctx.job ? `job:${ctx.job}` : ""].filter(Boolean);
  const heads: string[] = [];
  for (const key of ctx.graph.bySeat.keys()) {
    const [topic, facet, scope] = key.split("|");
    if (topic !== "client_rule" || !scopes.includes(scope)) continue;
    const r = ctx.graph.resolveExact({ topic, facet, scope }, ctx.asOf);
    if (r.current_card) heads.push(r.current_card, ...r.coexisting);
  }
  return uniq(heads).map((id) => ctx.graph.cards.get(id)!).filter((c) => c.mode === "decides");
}

export function detectP4(ctx: DetectCtx): Flag {
  const q = ctx.focusQuote;
  const broken: { card: string; rule: Rule; evidence: string[] }[] = [];
  if (q && ctx.job) {
    const notices = ctx.data.tables.events
      .filter((e) => e.quote_id === q.quote_id && e.event === "notified" && ms(e.at) <= Math.max(ctx.asOf, q.at))
      .sort((a, b) => ms(a.at) - ms(b.at));
    const noticeRecs = notices.map((e) => ctx.docs.recordFor("submission_event", e.event_id).record_id);
    for (const card of rulesInForce(ctx)) {
      const rule = classifyRule(card.quote);
      if (!rule) continue;
      let hit: string[] = [];
      if (rule.kind === "cap" && q.total > rule.amount) hit = [q.record.record_id];
      if (rule.kind === "recipients") hit = notices.flatMap((e, i) => (Number(e.recipients_count) > rule.max ? [noticeRecs[i]] : []));
      if (rule.kind === "portal" && /\b(email|emailing|pdf)\b/i.test(q.record.text)) hit = [q.record.record_id];
      if (rule.kind === "no_trip" && q.lines.some((l) => /trip|mobiliz|travel/i.test(l.description))) hit = [q.record.record_id];
      if (rule.kind === "quiet") {
        hit = notices
          .map((e, i) => ({ e, i }))
          .filter(({ e, i }) => i > 0 && businessDaysBetween(ms(notices[i - 1].at), ms(e.at)) < rule.businessDays)
          .map(({ i }) => noticeRecs[i]);
      }
      if (hit.length) broken.push({ card: card.card_id, rule, evidence: hit });
    }
  }
  return {
    pattern: "P4",
    fired: broken.length > 0,
    evidence: uniq(broken.flatMap((b) => [b.card, ...b.evidence])),
    details: { broken, rules_checked: rulesInForce(ctx).map((c) => c.card_id) },
  };
}
