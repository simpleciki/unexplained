// Where the ingested cards are read from: state/ (a local ingest) when it has one, else the committed, read-only
// snapshot (snapshot/ingest-2026-10-23/), so a fresh clone with no keys can open the check page and reproduce the
// value metrics. Only reads pick a source; an ingest always writes state/, never the snapshot.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SNAPSHOT = "snapshot/ingest-2026-10-23";

export type IngestSource = { dir: string; kind: "state" | "snapshot"; line: string };

export function ingestSource(root: string): IngestSource {
  if (existsSync(join(root, "state", "cards.json"))) return { dir: join(root, "state"), kind: "state", line: "reading cards from state/ (local ingest)" };
  const snap = join(root, SNAPSHOT);
  if (existsSync(join(snap, "cards.json"))) return { dir: snap, kind: "snapshot", line: `reading cards from ${SNAPSHOT} (no local ingest found)` };
  throw new Error(`no ingested cards: neither state/cards.json nor ${SNAPSHOT}/cards.json exists; run \`npm run ingest -- --max-calls N\` first`);
}
