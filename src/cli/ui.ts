// npm run ui [-- --source files|zetaris]: the gatekeeper screen on http://127.0.0.1:${UI_PORT:-8095}/.
// Never calls a model (see src/ui/server.ts).
import { startServer } from "../ui/server.ts";
import { main, root } from "./args.ts";

main(() => startServer(root, process.argv.slice(2)));
