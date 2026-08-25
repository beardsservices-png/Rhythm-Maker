// studio-assist.js — Claude edits the song, using real tools.
//
// The mechanism matters here. The old /api/assist asked for JSON in prose and
// regex'd it out of the reply, which is why musicinspiration's ideas could
// come back malformed. This uses TOOL USE instead: Claude is handed a typed
// set of operations and calls them, so the API itself guarantees the shape.
// `strict: true` means the arguments validate exactly — a bad edit can't reach
// the studio as half-parsed text.
//
// These tools are never executed on the server. Every one of them changes
// something that lives in the browser — a knob, a pattern, the arrangement —
// so the endpoint collects Claude's tool calls and hands them back as an
// action list for the page to apply. Same shape as Rhythm Shop's assist
// panel, just far wider and type-checked.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const LANES = ['kick', 'snare', 'hat', 'openhat', 'clap', 'shaker'];
const VARIATIONS = ['A', 'B', 'C', 'D'];
const VOICE_PARAMS = ['punchRatio', 'punchTime', 'decay', 'sustain', 'release', 'drive', 'tone'];

const TOOLS = [
  {
    name: 'set_tempo',
    description: 'Set the song tempo in beats per minute.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { bpm: { type: 'integer', minimum: 40, maximum: 220 } },
      required: ['bpm'],
      additionalProperties: false
    }
  },
  {
    name: 'set_drum_pattern',
    description:
      'Write a drum pattern for one lane into one variation. `steps` is 16 booleans, ' +
      'one per sixteenth note of a bar — step 0 is the downbeat, 4 is beat 2, 8 is beat 3, 12 is beat 4.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        lane: { type: 'string', enum: LANES },
        variation: { type: 'string', enum: VARIATIONS },
        steps: { type: 'array', items: { type: 'boolean' }, minItems: 16, maxItems: 16 }
      },
      required: ['lane', 'variation', 'steps'],
      additionalProperties: false
    }
  },
  {
    name: 'set_bass_pattern',
    description:
      'Write the 808 bassline for one variation. `notes` has 16 entries, one per sixteenth. ' +
      'Each is either null for a rest, or {midi, slide}. MIDI 36 is C2, a typical 808 root. ' +
      'slide:true glides from the previous note instead of retriggering — it only works when the ' +
      'step before it also has a note.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        variation: { type: 'string', enum: VARIATIONS },
        notes: {
          type: 'array',
          minItems: 16,
          maxItems: 16,
          items: {
            type: ['object', 'null'],
            properties: {
              midi: { type: 'integer', minimum: 20, maximum: 60 },
              slide: { type: 'boolean' }
            },
            required: ['midi', 'slide'],
            additionalProperties: false
          }
        }
      },
      required: ['variation', 'notes'],
      additionalProperties: false
    }
  },
  {
    name: 'switch_variation',
    description:
      'Switch which variation a part is playing. part is a lane name, "bass", or "all". ' +
      'Takes effect on the next bar.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        part: { type: 'string', enum: [...LANES, 'bass', 'all'] },
        variation: { type: 'string', enum: VARIATIONS }
      },
      required: ['part', 'variation'],
      additionalProperties: false
    }
  },
  {
    name: 'set_arrangement',
    description:
      'Write the song structure — the ordered list of sections. Each section names a variation ' +
      'and how many bars it lasts. Example: verse A for 8, chorus B for 8, verse A for 8, bridge C for 4.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              variation: { type: 'string', enum: VARIATIONS },
              bars: { type: 'integer', minimum: 1, maximum: 64 }
            },
            required: ['variation', 'bars'],
            additionalProperties: false
          }
        },
        enable: { type: 'boolean' }
      },
      required: ['sections', 'enable'],
      additionalProperties: false
    }
  },
  {
    name: 'set_voice_param',
    description:
      'Adjust the 808 sound. punchRatio 1-10 is how far above the note the pitch drop starts ' +
      '(higher = more click). punchTime 0.005-0.15s is how fast it drops. decay/release in seconds. ' +
      'sustain 0-1. drive 1-20 is saturation — higher makes it audible on small speakers. ' +
      'tone 200-6000Hz is a lowpass cutoff.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        param: { type: 'string', enum: VOICE_PARAMS },
        value: { type: 'number' }
      },
      required: ['param', 'value'],
      additionalProperties: false
    }
  },
  {
    name: 'mute_lane',
    description: 'Mute or unmute one drum lane.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        lane: { type: 'string', enum: LANES },
        muted: { type: 'boolean' }
      },
      required: ['lane', 'muted'],
      additionalProperties: false
    }
  },
  {
    name: 'set_loop_volume',
    description: 'Set the volume of one recorded loop slot (1-4). 0 is silent, 1 is normal.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        slot: { type: 'integer', minimum: 1, maximum: 4 },
        volume: { type: 'number', minimum: 0, maximum: 1.5 }
      },
      required: ['slot', 'volume'],
      additionalProperties: false
    }
  }
];

const SYSTEM = `You are the producer sitting next to someone making a track in BHS Studio.

You have real control: your tool calls change their song directly. Use them rather than
describing what they should click.

The studio has six drum lanes, an 808 bassline, four loop slots for live recordings, and four
variations (A/B/C/D) of every part that can be switched independently or arranged into sections.
Patterns are one bar of sixteenth notes.

How to work:
- Make the change. Don't ask permission for ordinary edits.
- Change only what was asked for. If they say "busier hats", don't also rewrite the kick.
- When writing a new section, build it from what's already there rather than something unrelated —
  a chorus is usually the verse with more going on.
- Musical defaults: kick on 0 and around 6/10, snare on 4 and 12, hats on eighths or sixteenths.
  Trap sits near 130-150 BPM with sparse kicks and rolling hats; boom bap near 85-95.
- If asked for something you can't do with these tools (add a piano, apply reverb), say so plainly
  in one sentence and offer the closest thing you can do.

Then tell them what you changed in one or two plain sentences. No jargon, no lists of tool names.`;

/** Describe the current song so Claude edits what's actually there. */
function describeState(state) {
  if (!state) return 'The project state was not provided.';
  const lines = [];
  lines.push(`Tempo: ${state.bpm} BPM.`);
  if (state.playing) lines.push('Currently playing.');

  if (Array.isArray(state.drums)) {
    state.drums.forEach((d, i) => {
      const name = LANES[i] || ('lane' + i);
      const cur = VARIATIONS[d.current] || 'A';
      const banks = (d.banks || [])
        .map((b, v) => `${VARIATIONS[v]}=[${(b || []).map(x => (x ? 1 : 0)).join('')}]`)
        .join(' ');
      lines.push(`${name}: playing ${cur}${d.muted ? ' (muted)' : ''}; ${banks}`);
    });
  }
  if (state.bass) {
    const cur = VARIATIONS[state.bass.current] || 'A';
    const banks = (state.bass.banks || [])
      .map((b, v) => {
        const notes = (b || [])
          .map((n, i) => (n ? `${i}:${n.midi}${n.slide ? 's' : ''}` : null))
          .filter(Boolean).join(' ');
        return `${VARIATIONS[v]}=[${notes || 'empty'}]`;
      }).join(' ');
    lines.push(`bass: playing ${cur}; ${banks}`);
  }
  if (state.voice) {
    lines.push('808 settings: ' + Object.entries(state.voice)
      .map(([k, v]) => `${k}=${v}`).join(', '));
  }
  if (state.song) {
    const secs = (state.song.blocks || [])
      .map(b => `${VARIATIONS[b.v]}×${b.bars}`).join(' → ');
    lines.push(`Arrangement (${state.song.enabled ? 'on' : 'off'}): ${secs}`);
  }
  if (Array.isArray(state.loops) && state.loops.length) {
    lines.push('Recorded loops: ' + state.loops
      .map(l => `slot ${l.index + 1} (${l.bars} bars, vol ${l.volume})`).join(', '));
  }
  return lines.join('\n');
}

async function handleStudioAssist(req, res, readBody) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Claude is not connected yet — ANTHROPIC_API_KEY is not set on the server.'
    }));
  }

  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const message = String(body.message || '').slice(0, 2000).trim();
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Say what you want changed.' }));
    }

    const client = new Anthropic({ apiKey: key });

    const response = await client.messages.create({
      model: MODEL,
      // Generous on purpose: thinking is on by default for Opus 5 and counts
      // against this ceiling, so a small cap truncates mid-answer.
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: TOOLS,
      messages: [{
        role: 'user',
        content: `Here is the song right now:\n\n${describeState(body.state)}\n\nWhat they asked for: ${message}`
      }]
    });

    const actions = [];
    let reply = '';
    for (const block of response.content) {
      if (block.type === 'text') reply += block.text;
      else if (block.type === 'tool_use') actions.push({ name: block.name, input: block.input });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      reply: reply.trim(),
      actions,
      stopReason: response.stop_reason
    }));
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    res.writeHead(status === 401 ? 401 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: status === 401
        ? 'Claude rejected the API key. Check ANTHROPIC_API_KEY on Railway.'
        : 'Could not reach Claude: ' + (e && e.message ? e.message : 'unknown error')
    }));
  }
}

module.exports = { handleStudioAssist, TOOLS, LANES, VARIATIONS };
