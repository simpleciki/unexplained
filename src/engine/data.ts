// Loads data/ (records + tables). Never loads eval/gold/: gold files are passed in by callers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset, Row, SourceRecord } from "./types.ts";

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => c.length)) rows.push(row);
  }
  const [header, ...body] = rows;
  return (body ?? []).map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""])));
}

export function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function loadDataset(root: string): Dataset {
  const read = (rel: string) => readFileSync(join(root, "data", rel), "utf8");
  return {
    records: parseJsonl<SourceRecord>(read("records/records.jsonl")),
    tables: {
      clients: parseCsv(read("tables/clients.csv")),
      workOrders: parseCsv(read("tables/work_orders.csv")),
      quotes: parseCsv(read("tables/quote_versions.csv")),
      quoteLines: parseCsv(read("tables/quote_lines.csv")),
      events: parseCsv(read("tables/submission_events.csv")),
      invoices: parseCsv(read("tables/invoices.csv")),
      invoiceLines: parseCsv(read("tables/invoice_lines.csv")),
    },
  };
}
