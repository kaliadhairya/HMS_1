function serialize(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

class AuditService {
  constructor(repository) {
    this.repository = repository;
  }

  record(input) {
    return this.repository.create({
      user_id: input.userId ?? null,
      action: input.action,
      module: input.module ?? null,
      record_id: input.recordId ?? null,
      old_value: serialize(input.oldValue),
      new_value: serialize(input.newValue),
      ip_address: input.ipAddress ?? null,
      created_at: input.createdAt || new Date(),
      idempotency_key: input.idempotencyKey ?? null,
    });
  }
}

module.exports = { AuditService };
