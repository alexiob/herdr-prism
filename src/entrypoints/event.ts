import{finiteRefresh}from'../runtime/service.ts';
finiteRefresh().catch(error=>{console.error(error.message);process.exitCode=1;});
