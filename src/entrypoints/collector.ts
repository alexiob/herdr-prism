import {parseArguments} from '../runtime/actions.ts';
import {runCollectorService} from '../runtime/collector-service.ts';
const args=parseArguments(['collector',...process.argv.slice(2)]);
runCollectorService(args.options).catch(error=>{console.error(error.message);process.exitCode=1;});
