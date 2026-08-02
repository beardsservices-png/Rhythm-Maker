// assist-client.js — talks to the server-side /api/assist endpoint.
// The model never invents a whole beat here — it either explains something
// or returns small, targeted edits (e.g. "add swing to the hi-hat") that the
// caller applies on top of whatever the person already built.

const RhythmAssist = (() => {
  async function ask(instruction, context) {
    try {
      const res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, context })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        return { ok: false, error: errBody.error || `Request failed (${res.status})` };
      }
      const data = await res.json();
      return { ok: true, explanation: data.explanation || '', actions: data.actions || [] };
    } catch (e) {
      return { ok: false, error: 'Could not reach the assist server.' };
    }
  }
  return { ask };
})();
