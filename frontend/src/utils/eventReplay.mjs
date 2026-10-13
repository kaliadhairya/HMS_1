// Only a completed catch-up page advances the replay cursor. Live events never
// skip a missing range, and pending live duplicates are pruned after catch-up.
export function createEventReplay(getPage, deliver) {
  let cursor = null;
  let active = true;
  let running = false;
  const seen = new Map();
  function accept(data) {
    if (!active) return false;
    if (!Number.isSafeInteger(data?.delivery_sequence)) return true;
    if (cursor !== null && data.delivery_sequence <= cursor) return false;
    if (seen.has(data.event_id)) return false;
    seen.set(data.event_id, data.delivery_sequence);
    return true;
  }
  async function catchUp() {
    if (!active || running) return;
    running = true;
    try {
      if (cursor === null) {
        const page = await getPage(null);
        if (!active) return;
        cursor = page.latest_sequence;
      } else {
        let more;
        do {
          const page = await getPage(cursor);
          if (!active) return;
          for (const event of page.data || []) if (accept(event.data)) deliver(event.type, event.data);
          if (!Number.isSafeInteger(page.next_sequence) || page.next_sequence < cursor || (page.has_more && page.next_sequence === cursor)) throw new Error('Invalid replay cursor');
          cursor = page.next_sequence;
          more = page.has_more;
        } while (more && active);
      }
      for (const [id, sequence] of seen) if (sequence <= cursor) seen.delete(id);
    } finally { running = false; }
  }
  return { accept, catchUp, stop() { active = false; seen.clear(); } };
}
