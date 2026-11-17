export {isRouteDisposalError,isToolExecutionFailure} from '../ui/public/result-summary.js';
export async function closeRoutedContext(context){
 if(!context)return;
 // Only after the check has finished: detach handlers before closing so late
 // callbacks cannot turn a completed observation into a runner failure.
 try{await context.unrouteAll({behavior:'ignoreErrors'});}finally{await context.close();}
}
export async function abortUnfinishedRoute(route){
 try{await route.abort();}catch(error){
  // Navigation/reload may already have completed the route. Do not attempt a
  // second terminal operation, but retain all other routing errors.
  if(!/Route is already handled!/.test(error.message))throw error;
 }
}
