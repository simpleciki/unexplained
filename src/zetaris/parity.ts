// Parity between the two ways the engine can load its data: data/ files and Zetaris. Both are projected
// through the same table definitions and value formats, sorted by key, and compared value by value.
import type { Dataset } from "../engine/types.ts";
import { TABLES, formatValue } from "./schema.ts";
import { rowsFor } from "./source-server.ts";
import { VIEWS, computeViews, formatViewRows } from "./views.ts";

export type TableParity = { table: string; files: number; zetaris: number; firstDifference: string | null };

function project(data: Dataset, t: (typeof TABLES)[number]): Record<string, string>[] {
  const key = (r: Record<string, string>) => t.orderBy.map((c) => r[c].padStart(12, "0")).join("|");
  return rowsFor(data, t)
    .map((r) => Object.fromEntries(t.columns.map(([c, type]) => [c, formatValue(r[c], type)])))
    .sort((a, b) => key(a).localeCompare(key(b)));
}

export function compareDatasets(files: Dataset, zetaris: Dataset): TableParity[] {
  return [...compareTables(files, zetaris), ...compareViews(files, zetaris)];
}

// The cross-source views: Zetaris's SQL join against the in-memory equivalent built from data/.
export function compareViews(files: Dataset, zetaris: Dataset): TableParity[] {
  if (!zetaris.views) return [];
  const expected = files.views ?? computeViews(files);
  return VIEWS.map((v) => {
    const a = formatViewRows(v, expected[v.name] ?? []);
    const b = formatViewRows(v, zetaris.views?.[v.name] ?? []);
    let diff: string | null = null;
    for (let i = 0; i < Math.max(a.length, b.length) && !diff; i++) {
      if (!a[i] || !b[i]) diff = `row ${i}: only in ${a[i] ? "files" : "zetaris"} (${JSON.stringify(a[i] ?? b[i]).slice(0, 160)})`;
      else {
        const col = v.columns.find(([c]) => a[i][c] !== b[i][c])?.[0];
        if (col) diff = `row ${i} (${v.orderBy.map((k) => a[i][k]).join(", ")}): ${col} files=${JSON.stringify(a[i][col]).slice(0, 80)} zetaris=${JSON.stringify(b[i][col]).slice(0, 80)}`;
      }
    }
    return { table: v.view, files: a.length, zetaris: b.length, firstDifference: diff };
  });
}

function compareTables(files: Dataset, zetaris: Dataset): TableParity[] {
  return TABLES.map((t) => {
    const a = project(files, t);
    const b = project(zetaris, t);
    let diff: string | null = null;
    for (let i = 0; i < Math.max(a.length, b.length) && !diff; i++) {
      if (!a[i] || !b[i]) diff = `row ${i}: only in ${a[i] ? "files" : "zetaris"} (${JSON.stringify(a[i] ?? b[i]).slice(0, 160)})`;
      else {
        const col = t.columns.find(([c]) => a[i][c] !== b[i][c])?.[0];
        if (col) diff = `row ${i} (${t.orderBy.map((k) => a[i][k]).join(", ")}): ${col} files=${JSON.stringify(a[i][col]).slice(0, 80)} zetaris=${JSON.stringify(b[i][col]).slice(0, 80)}`;
      }
    }
    return { table: `/${t.source}/${t.path}`, files: a.length, zetaris: b.length, firstDifference: diff };
  });
}
