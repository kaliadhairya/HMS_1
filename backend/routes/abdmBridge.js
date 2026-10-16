const express = require('express');
const { sequelize } = require('../models/db');
const G = require('../services/abdmGateway');
const A = require('../services/abdm');
const I = require('../services/interfaces');
const contracts = require('../domain/abdmContracts.cts');
const withAccount = (t, run) => require('../services/integrationContext.cts').withAccount(t,Number(process.env.HMS_ABDM_SERVICE_USER_ID),process.env.HMS_ABDM_FACILITY_ID,'abdm',run);

// What the ABDM gateway calls on this hospital (Phase 6C-6E), mounted at
// /abdm (ABDM_BRIDGE_PUBLIC_URL is that address as ABDM sees it). Every call
// must carry a token signed by the gateway, except the data push, which comes
// from another facility and is only usable with this hospital's key for that
// transaction. Each call is recorded once (REQUEST-ID); a repeat is answered
// without being processed again. ABDM expects 202 and an answer later.
const router = express.Router();

const handlers = {
  [G.CALLBACKS.share]: { type: 'patient-share', run: (b, t) => A.receiveShare(b, t) },
  [G.CALLBACKS.discover]: { type: 'discover', run: (b, t) => A.discover(b, t) },
  [G.CALLBACKS.linkInit]: { type: 'link-init', run: (b, t) => A.linkInit(b, t) },
  [G.CALLBACKS.linkConfirm]: { type: 'link-confirm', run: (b, t) => A.linkConfirm(b, t) },
  [G.CALLBACKS.linkTokenOnGenerate]: { type: 'on-generate-token', run: (b, t) => A.onLinkToken(b, t) },
  [G.CALLBACKS.linkOnCareContext]: { type: 'on-carecontext', run: (b, t) => A.onCareContextLinked(b, t) },
  [G.CALLBACKS.consentHipNotify]: { type: 'consent-hip-notify', run: (b, t) => A.consentNotifyHip(b, t) },
  [G.CALLBACKS.hiRequest]: { type: 'hi-request', run: (b, t) => A.hiRequest(b, t) },
  [G.CALLBACKS.consentOnInit]: { type: 'consent-on-init', run: (b, t) => A.onConsentInit(b, t) },
  [G.CALLBACKS.consentHiuNotify]: { type: 'consent-hiu-notify', run: (b, t) => A.consentNotifyHiu(b, t) },
  [G.CALLBACKS.consentOnFetch]: { type: 'consent-on-fetch', run: (b, t) => A.onConsentFetch(b, t) },
  [G.CALLBACKS.hiOnRequest]: { type: 'hi-on-request', run: (b, t) => A.onHiRequest(b, t) },
  [G.CALLBACKS.dataPush]: { type: 'data-push', run: (b, t) => A.receiveData(b, t), unsigned: true },
};

router.post(Object.keys(handlers), async (req, res) => {
  const h = handlers[req.path];
  let verifiedGateway=false;
  const requestId = String(req.get('request-id') || req.body?.requestId || req.body?.transactionId || '').slice(0, 200);
  try {
    if (!h.unsigned) { await G.verifyGatewayCall(req); verifiedGateway=true; }
    if (!requestId) return res.status(400).json({ error: { code: 'ABDM-1000', message: 'REQUEST-ID header is required.' } });
    // The callback's contract (B2): refuse an incomplete body before any processing.
    const gaps = contracts.missing(h.type, req.body);
    if (gaps.length) throw Object.assign(new Error(`The ${h.type} callback is missing: ${gaps.join(', ')}.`), { status: 400 });
    const body = { ...req.body, requestId: req.body?.requestId || requestId };
    const outcome = await sequelize.transaction(async (t) => withAccount(t,async () => {
      const { message, duplicate } = await I.receive({ system: h.unsigned ? 'abdm-datapush' : 'abdm-gateway', type: h.type, version: 'v3', externalId: requestId, raw: JSON.stringify(req.body), correlationId: body.transactionId || null }, t);
      if (duplicate) return { duplicate: true };
      const result = await h.run(body, t);
      await I.settle(message.id, 'Processed', {}, t);
      return { result };
    }));
    // Discovery answers in the response as well (ABDM V3 discovery may be synchronous).
    return res.status(202).json(h.type === 'discover' && outcome.result ? outcome.result : {});
  } catch (err) {
    // Refusals are recorded as their own message so the record shows them.
    if (requestId && verifiedGateway) await sequelize.transaction((t) => withAccount(t,()=>I.receive({ system: 'abdm-gateway', type: `${h.type}:refused`, version: 'v3', externalId: `${requestId}:refused:${Date.now()}`, raw: JSON.stringify(req.body || {}) }, t)
      .then(({ message }) => I.settle(message.id, 'Rejected', { error: err.message }, t)))).catch(() => {});
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error('ABDM bridge failed:', err.original?.message || err.message);
    return res.status(status).json({ error: { code: status === 401 ? 'ABDM-1017' : 'ABDM-1000', message: status === 500 ? 'Could not process the request.' : err.message } });
  }
});

module.exports = router;
