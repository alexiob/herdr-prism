import { parseArguments } from "../runtime/actions.js";
import { runCollectorService } from "../runtime/collector-service.js";
const args = parseArguments(['collector', ...process.argv.slice(2)]);
runCollectorService(args.options).catch(error => { console.error(error.message); process.exitCode = 1; });
