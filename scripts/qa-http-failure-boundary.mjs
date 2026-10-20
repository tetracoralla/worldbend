/** QA server diagnostics stay on the private runner, never in an HTTP body. */
export function createQaHttpFailureBoundary(label) {
  const retained=[];
  let omitted=0;
  return {
    respond(request,response,error,status) {
      if(retained.length<8)retained.push({method:request.method,url:request.url,error});
      else omitted++;
      if(response.destroyed||response.writableEnded)return;
      if(response.headersSent){response.destroy();return;}
      response.writeHead(status,{
        "Content-Type":"text/plain; charset=utf-8",
        "Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff",
      });
      response.end("Fixture request failed.\n");
    },
    decorate(runnerError) {
      if(!retained.length)return runnerError;
      const causes=retained.map(item=>new Error(`Private fixture request ${item.method} ${item.url}`,{cause:item.error}));
      causes.push(runnerError);
      return new Error(`${label}: QA runner failed`,{cause:new AggregateError(causes,`Private fixture failures; omitted=${omitted}`)});
    },
  };
}
