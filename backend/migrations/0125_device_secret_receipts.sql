-- Device secrets are one-time responses, not durable response-cache content.
-- Preserve the original command hash/result identity and activation metadata;
-- an uncertain old delivery requires a replacement contract/key, not replay.
UPDATE hms_idempotency_keys SET response_status=409,
 response_body=jsonb_build_object('success',false,'code','ONE_TIME_SECRET_ALREADY_ISSUED',
  'message','The device key was issued once. If its response was lost, retire the contract and approve a replacement version.',
  'data',(response_body->'data')-'device_key'-'api_key_hash')
 WHERE path ~ '^/api/devices/[^/]+/approve([?].*)?$'
 AND state='completed' AND response_body #> '{data,device_key}' IS NOT NULL;
