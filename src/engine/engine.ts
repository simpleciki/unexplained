// Builds the engine from data/ plus extracted cards and relation judgments (gold files in oracle mode,
// passed in by the caller; the engine never opens eval/gold/ itself).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckedCard, Dataset, DecisionCard, EventSink, RelationEdge } from "./types.ts";
import { noEvents } from "./types.ts";
import { loadDataset } from "./data.ts";
import { Docs } from "./docs.ts";
import { writeMemory } from "./memory.ts";
import type { MemoryWrite } from "./memory.ts";
import { SeatGraph } from "./seats.ts";
import { verifyCards } from "./verify.ts";
import type { Vocab } from "./vocab.ts";
import { loadVocab } from "./vocab.ts";

export type Engine = {
  data: Dataset;
  vocab: Vocab;
  cards: CheckedCard[];
  graph: SeatGraph;
  docs: Docs;
  memory: MemoryWrite;
};

// data: the dataset already loaded (from Zetaris, say); data/ files otherwise.
export function buildEngine(root: string, cards: DecisionCard[], edges: RelationEdge[], emit: EventSink = noEvents, preloaded?: Dataset): Engine {
  const data = preloaded ?? loadDataset(root);
  const vocab = loadVocab(root);
  const checked = verifyCards(cards, data.records, vocab, emit);
  for (const c of checked) if (c.result !== "PASS") emit({ action: "card_rejected", ref: c.card_id, outcome: c.result, details: { reason: c.reason } });
  const graph = new SeatGraph(checked, edges, data.records, vocab);
  for (const l of graph.links) if (l.status === "conflict") emit({ action: "unresolved_conflict", ref: `${l.from}->${l.to}`, outcome: l.why });
  const docs = new Docs(data, checked, vocab);
  const memory = writeMemory(graph, emit);
  return { data, vocab, cards: checked, graph, docs, memory };
}

// <dir>/seats.json is the authority; <dir>/hmem-snapshot.json is H-MEM's view of the same cards.
// A live ingest writes state/; the oracle writes state/oracle/ so it never overwrites a live run.
export function saveState(engine: Engine, root: string, dir = join(root, "state")) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "seats.json"), JSON.stringify(engine.graph.seatTable(), null, 2) + "\n");
  const snap = engine.memory.hmem.store.snapshotAll();
  const records = snap.records.map(({ embedding: _e, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  writeFileSync(
    join(dir, "hmem-snapshot.json"),
    JSON.stringify({ seq: snap.seq, records, ledger: engine.memory.hmem.ledger.stats() }, null, 2) + "\n",
  );
}
