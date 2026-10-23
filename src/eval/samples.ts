// The three judge sample questions (eval/gold/samples.json), as question inputs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl } from "../engine/data.ts";
import type { GoldQuestion } from "./scoring.ts";

export function loadSamples(root: string): GoldQuestion[] {
  const ids = (JSON.parse(readFileSync(join(root, "eval/gold/samples.json"), "utf8")) as { question_ids: string[] }).question_ids;
  const all = parseJsonl<GoldQuestion>(readFileSync(join(root, "eval/gold/gold_questions.jsonl"), "utf8"));
  return ids.map((id) => all.find((q) => q.question_id === id)!).filter(Boolean);
}
