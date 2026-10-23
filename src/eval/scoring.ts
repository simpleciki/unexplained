// Scoring shared by the oracle and live evaluations. Warnings (P1-P7) are alarms; time tags
// (T2, T6, T10) name the time trap a question tests and are scored separately.
import type { Answer } from "../engine/answer.ts";

export type GoldQuestion = {
  question_id: string;
  pattern: string;
  question: string;
  as_of: string | null;
  seats: string[];
  expected_current_card: string | null;
  expected_in_effect_card: string | null;
  expected_reasons: string[];
  expected_flags: string[];
  expected_client_explanation?: "present" | "absent";
};

// Warnings are alarms (P1-P7). Time tags (T2, T6, T10) name the time trap a question tests; they are
// never alarms and are scored separately.
const WARNINGS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const TIME_TAGS = ["T2", "T6", "T10"];
const PATTERNS = [...WARNINGS, ...TIME_TAGS];

export type Score = {
  question_id: string;
  pattern: string;
  warnings_recalled: boolean; // expected P-flags are a subset of predicted P-flags
  ctrl_false_alarm: boolean; // any P-warning on a CTRL question
  time_tags_ok: boolean;
  current_ok: boolean;
  in_effect_ok: boolean;
  reasons_ok: boolean;
  predicted_flags: string[];
  expected_flags: string[];
  additional_warnings: string[]; // extra P-warnings on non-CTRL questions: audited by a human, not failures
  why: string[]; // metric failures
  time_tag_why: string | null;
};

export function scoreQuestion(q: GoldQuestion, a: Answer): Score {
  const pred = a.flags.map((f) => f.pattern).sort();
  const want = [...q.expected_flags].sort();
  const predW = pred.filter((p) => WARNINGS.includes(p));
  const wantW = want.filter((p) => WARNINGS.includes(p));
  const predT = pred.filter((p) => TIME_TAGS.includes(p));
  const wantT = want.filter((p) => TIME_TAGS.includes(p));
  const missingW = wantW.filter((p) => !predW.includes(p));
  const ctrlAlarm = q.pattern === "CTRL" && predW.length > 0;
  const missingReasons = q.expected_reasons.filter((r) => r !== "not_recorded" && !a.reasons.includes(r));
  const why: string[] = [];
  if (missingW.length) why.push(`missing warning ${missingW.join(" ")}`);
  if (ctrlAlarm) why.push(`CTRL false alarm ${predW.join(" ")}`);
  if (a.current_card !== q.expected_current_card) why.push(`current ${a.current_card ?? "none"} != ${q.expected_current_card}`);
  if (a.in_effect_card !== q.expected_in_effect_card) why.push(`in_effect ${a.in_effect_card ?? "none"} != ${q.expected_in_effect_card}`);
  if (missingReasons.length) why.push(`reasons missing ${missingReasons.join(",")}`);
  const tExtra = predT.filter((p) => !wantT.includes(p));
  const tMissing = wantT.filter((p) => !predT.includes(p));
  const timeOk = !tExtra.length && !tMissing.length;
  return {
    question_id: q.question_id,
    pattern: q.pattern,
    warnings_recalled: missingW.length === 0,
    ctrl_false_alarm: ctrlAlarm,
    time_tags_ok: timeOk,
    current_ok: a.current_card === q.expected_current_card,
    in_effect_ok: a.in_effect_card === q.expected_in_effect_card,
    reasons_ok: missingReasons.length === 0,
    predicted_flags: pred,
    expected_flags: want,
    additional_warnings: q.pattern === "CTRL" ? [] : predW.filter((p) => !wantW.includes(p)),
    why,
    time_tag_why: timeOk ? null : `time tags ${tExtra.map((p) => `+${p}`).concat(tMissing.map((p) => `-${p}`)).join(" ")}`,
  };
}

export function summarise(scores: Score[]) {
  const rate = (xs: boolean[]) => (xs.length ? Math.round((xs.filter(Boolean).length / xs.length) * 1000) / 1000 : null);
  const perPattern = Object.fromEntries(
    PATTERNS.map((p) => {
      const tp = scores.filter((s) => s.predicted_flags.includes(p) && s.expected_flags.includes(p)).length;
      const fp = scores.filter((s) => s.predicted_flags.includes(p) && !s.expected_flags.includes(p)).length;
      const fn = scores.filter((s) => !s.predicted_flags.includes(p) && s.expected_flags.includes(p)).length;
      return [p, { tp, fp, fn, precision: tp + fp ? Math.round((tp / (tp + fp)) * 1000) / 1000 : null, recall: tp + fn ? Math.round((tp / (tp + fn)) * 1000) / 1000 : null }];
    }),
  );
  const byQuestionPattern = Object.fromEntries(
    [...new Set(scores.map((s) => s.pattern))].sort().map((p) => {
      const g = scores.filter((s) => s.pattern === p);
      return [
        p,
        {
          n: g.length,
          warnings_recalled: rate(g.map((s) => s.warnings_recalled)),
          time_tags: rate(g.map((s) => s.time_tags_ok)),
          current: rate(g.map((s) => s.current_ok)),
          in_effect: rate(g.map((s) => s.in_effect_ok)),
          reasons: rate(g.map((s) => s.reasons_ok)),
        },
      ];
    }),
  );
  const ctrl = scores.filter((s) => s.pattern === "CTRL");
  const timed = scores.filter((s) => s.expected_flags.some((f) => TIME_TAGS.includes(f)) || s.predicted_flags.some((f) => TIME_TAGS.includes(f)));
  return {
    n: scores.length,
    required_warning_recall: rate(scores.filter((s) => s.expected_flags.some((f) => WARNINGS.includes(f))).map((s) => s.warnings_recalled)),
    time_tag_accuracy: rate(timed.map((s) => s.time_tags_ok)),
    time_tag_n: timed.length,
    current_card: rate(scores.map((s) => s.current_ok)),
    in_effect_card: rate(scores.map((s) => s.in_effect_ok)),
    reasons_superset: rate(scores.map((s) => s.reasons_ok)),
    ctrl_false_alarms: ctrl.filter((s) => s.ctrl_false_alarm).length,
    ctrl_n: ctrl.length,
    flag_precision_recall: perPattern,
    by_question_pattern: byQuestionPattern,
  };
}
