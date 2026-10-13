// Maps database refusals that mean "the request conflicts with current data"
// to a client answer, so a clash is reported plainly and not as a server error.
//   23P01 exclusion violation (for example an overlapping appointment)
//   23505 unique violation
function conflictResponse(err, messages = {}) {
  const code = err?.original?.code || err?.parent?.code || err?.code;
  if (code === '23P01') return { status: 409, message: messages.exclusion || 'That time conflicts with an existing booking.' };
  if (code === '23505') return { status: 409, message: messages.unique || 'That record already exists.' };
  return null;
}

module.exports = { conflictResponse };
