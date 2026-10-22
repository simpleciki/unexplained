// Gold answers that look wrong after checking the records. Reported, never edited here or in eval/gold/
// (the dataset is frozen; the reviewer decides). Each entry names the records to check.
// The 2026-10-22 round was adjudicated and applied: see eval/gold/CHANGELOG.md.
export type SuspectedGoldError = { question_ids: string[]; issue: string; records: string[] };

export const SUSPECTED_GOLD_ERRORS: SuspectedGoldError[] = [];

// Bucket for every remaining failure, one line of evidence. Key "<question_id>#time" covers a time-tag mismatch.
// SPEC CONFLICT: the per-(client, trade) norm with a minimum of 2 approved versions leaves every P6 job
// without a norm; no (client, trade) pair behind a P6 gold question has 2 approved versions.
const P6_SPEC =
  "SPEC CONFLICT: P6 norm is per (client, trade) and needs >= 2 approved versions; this job's (client, trade) has fewer, so P6 says 'no norm yet'";
export const TRIAGE: Record<string, string> = {
  "q-p1-oc03-valves": `${P6_SPEC} (OC hvac: Q-OC-03-v1 only, rec-0109)`,
  "q-p1-rm04-paint": `${P6_SPEC} (RM general: Q-RM-04-v1 only)`,
  "q-p2-pw04-fold": `${P6_SPEC} (PW hvac: Q-PW-04-v1 only)`,
  "q-p2-oc03-lump-delta": `${P6_SPEC} (OC hvac: Q-OC-03-v1 only)`,
  "q-p2-rm04-trip-price": `${P6_SPEC} (RM general: Q-RM-04-v1 only)`,
  "q-p6-oc03-lump": `${P6_SPEC} (OC hvac: Q-OC-03-v1 only)`,
  "q-p6-pw04-fold": `${P6_SPEC} (PW hvac: Q-PW-04-v1 only)`,
  "q-p6-rm04-trip": `${P6_SPEC} (RM general: Q-RM-04-v1 only)`,
  "q-p6-nl04-weather": `${P6_SPEC} (NL roofing: none)`,
  "q-p6-pw03-trip": `${P6_SPEC} (PW roofing: Q-PW-03-v1 only; v2 is the quote being judged)`,
  "q-p7-oc03-inv": `${P6_SPEC} (OC hvac: Q-OC-03-v1 only)`,
  "q-p7-pw04-inv": `${P6_SPEC} (PW hvac: Q-PW-04-v1 only)`,
  "q-p7-rm04-inv": `${P6_SPEC} (RM general: Q-RM-04-v1 only)`,
};
