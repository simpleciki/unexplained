// npm run zetaris:register -- [--apply]
// Without --apply: print the SQL. With --apply: run it one statement at a time through the SQL editor
// endpoint (it accepts DDL), skip what already exists, stop at the first real error with Zetaris's
// message. Needs `npm run sources:serve` running.
import { clientFromEnv } from "../src/zetaris/client.ts";
import { applyStatements, registerStatements } from "../src/zetaris/register-sql.ts";

const apply = process.argv.includes("--apply");
const port = Number(process.env.SOURCE_PORT ?? 8790);
const statements = registerStatements(port);

if (!apply) {
  console.log(`-- ${statements.length} statements (dry run; add --apply to run them). Source server port ${port}.`);
  for (const s of statements) console.log(`\n-- ${s.label}\n${s.sql};`);
  process.exit(0);
}

const client = clientFromEnv();
const result = await applyStatements((sql) => client.query(sql), statements, (line) => console.log(line));
if (result.failed) {
  console.error(`FAILED   ${result.failed.label}\n${result.failed.message}\nstopped; ${result.created} created, ${result.skipped} already there.`);
  process.exit(1);
}
console.log(`done: ${result.created} created, ${result.skipped} already there.`);
