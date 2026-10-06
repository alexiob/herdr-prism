import { finiteRefresh } from "../runtime/service.js";
finiteRefresh().catch(error => { console.error(error.message); process.exitCode = 1; });
