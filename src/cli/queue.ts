// npm run queue [-- --job WO-xx] [--rebuild]
// The ledger line, every record that needs a person (id, type, author, job, why it was routed, full text, the
// model's candidate cards if any), then the records where the model found nothing, for a spot-check. Reads
// state/ and review/judgments.jsonl; never calls a model. The ledger is recomputed from state/cards.json +
// state/ingest-report.json + the judgments, so it is current after new judgments; --rebuild also writes it
// to state/review-queue.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { jobQueue, loadReviewView } from "../review/queue.ts";
import type { QueueItem } from "../review/queue.ts";
import { main, root } from "./args.ts";

main(async () => {
  const argv = process.argv.slice(2);
  const rebuild = argv.includes("--rebuild");
  const job = argv.includes("--job") ? argv[argv.indexOf("--job") + 1] : undefined;
  if (argv.includes("--job") && !job) throw new Error("--job needs a work order id, e.g. --job WO-NL-01");
  const view = loadReviewView(root);
  if (rebuild) writeFileSync(join(root, "state", "review-queue.json"), JSON.stringify(view.ledger, null, 2) + "\n");

  console.log(view.ledger.line);
  if (rebuild) console.log("wrote state/review-queue.json");
  const jobs = new Map(view.data.tables.workOrders.map((w) => [w.work_order_id, w]));
  const q = jobQueue(view, job);
  const print = (x: QueueItem) => {
    const w = x.job ? jobs.get(x.job) : undefined;
    console.log(`\n${x.record_id}  ${x.source_type}  by ${x.author}  ${x.recorded_at}  ${w ? `${w.work_order_id} "${w.job_title}"` : "(no job)"}`);
    console.log(`  why: ${x.why}`);
    console.log(`  text: ${x.text}`);
    for (const c of x.candidates) console.log(`  model candidate: ${c.mode} by ${c.decided_by} (${c.topic}) "${c.quote}"`);
  };
  console.log(`\nneeds your judgment${job ? ` on ${job}` : ""}: ${q.needs_human.length}`);
  q.needs_human.forEach(print);
  console.log(`\nmodel found nothing here — spot-check${job ? ` on ${job}` : ""}: ${q.spot_check.length}`);
  q.spot_check.forEach(print);
  if (q.confirmed.length) {
    console.log(`\nconfirmed by a person${job ? ` on ${job}` : ""}: ${q.confirmed.length}`);
    for (const x of q.confirmed) console.log(`  ${x.record_id}: ${x.why}`);
  }
});
