// Delay HTTP output until database receipts and access audit are durable.
// This also gates the first write of streaming PDF responses.
function beforeSend(res, priority, prepare) {
  if (!res.locals) res.locals = {};
  let gate = res.locals.responseGate;
  if (!gate) {
    gate = res.locals.responseGate = { hooks: [], queue: [], state: 'waiting' };
    const original = {};
    for (const name of ['writeHead', 'write', 'end', 'flushHeaders']) original[name] = res[name].bind(res);
    const json = res.json.bind(res);
    res.json = (body) => { res.locals.responseBody = body; return json(body); };
    const start = () => {
      if (gate.state !== 'waiting') return;
      gate.state = 'preparing';
      Promise.resolve().then(async () => {
        for (const hook of gate.hooks.sort((a, b) => a.priority - b.priority)) await hook.prepare();
        gate.state = 'open';
        for (const name of Object.keys(original)) res[name] = original[name];
        const queue = gate.queue.splice(0);
        for (const item of queue) original[item.name](...item.args);
        if (!res.writableEnded) res.emit('drain');
      }).catch(async (error) => {
        gate.state = 'failed';
        for (const name of Object.keys(original)) res[name] = original[name];
        gate.queue.length = 0;
        if (res.locals.abortCommand) await res.locals.abortCommand().catch(() => {});
        console.error('Response protection failed:', error.original?.message || error.code || error.name);
        if (res.destroyed) return;
        const body = JSON.stringify({ success: false, code: error.publicCode || 'RESPONSE_NOT_DURABLE', message: 'The operation could not be confirmed safely. Retry with the same request key.' });
        res.statusCode = 503;
        for (const name of ['Content-Length', 'ETag', 'Content-Disposition']) res.removeHeader(name);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        original.end(body);
      });
    };
    for (const name of Object.keys(original)) {
      res[name] = (...args) => {
        if (gate.state === 'open') return original[name](...args);
        if (gate.state === 'failed') return name === 'write' ? false : res;
        if (name === 'writeHead') res.statusCode = args[0];
        gate.queue.push({ name, args });
        // writeHead alone needn't flush; wait for the body or an explicit flush.
        if (name !== 'writeHead') start();
        return name === 'write' ? false : res;
      };
    }
  }
  if (gate.state !== 'waiting') throw new Error('Response protection registered after output started');
  gate.hooks.push({ priority, prepare });
}
module.exports = { beforeSend };
