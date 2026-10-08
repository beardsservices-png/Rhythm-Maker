// studio-assist.js — Claude edits the song, using real tools.
//
// Claude is handed a typed set of operations and calls them; `strict: true`
// means the arguments validate exactly, so a bad edit can't reach the studio
// as half-parsed text. The tools are never executed here: every one changes
// something that lives in the browser (a pattern, a section, a knob), so the
// endpoint collects the tool calls and hands them back as an action list for
// the page to apply through the same code the buttons use.
//
// Schemas stay plain on purpose — no numeric ranges or array-length limits,
// which strict mode doesn't accept everywhere. The ranges live in the
// descriptions, and the browser clamps every value it applies.
//
// Tracks are referred to by NAME (whatever the user called them: "Kick",
// "808", "Keys"). The song is described to Claude fresh on every request.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

const VARIATIONS = ['A', 'B', 'C', 'D'];
const INSTRUMENTS = ['808', 'piano', 'epiano', 'organ', 'strings', 'pad', 'lead', 'pluck', 'bell', 'synthbass', 'brass', 'flute'];
const ROLES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'tom', 'rim'];
const KITS = ['trap', 'boombap', 'house', 'lofi', 'live', 'classic'];

const obj = (properties, required) => ({
  type: 'object', properties, required: required || Object.keys(properties), additionalProperties: false
});
const trackField = { type: 'string', description: 'Track name exactly as listed in the song description.' };
const variationField = { type: 'string', enum: VARIATIONS };

const TOOLS = [
  {
    name: 'set_tempo',
    description: 'Set the song tempo in beats per minute (40–220).',
    strict: true,
    input_schema: obj({ bpm: { type: 'integer' } })
  },
  {
    name: 'set_drum_pattern',
    description:
      'Write one drum track\'s pattern into one variation, as a string with one character per sixteenth note: ' +
      '"." off, "x" hit, "X" accent (louder), "o" soft ghost note, "2"/"3"/"4" a roll of that many quick hits inside the ' +
      'sixteenth (trap hi-hat rolls). 16 characters per bar: 16 for a 1-bar pattern, 32 for 2 bars, 64 for 4. Step 0 is the ' +
      'downbeat; 4, 8, 12 are beats 2, 3, 4. Example trap hats: "x.x.x.x.x.x.3x44".',
    strict: true,
    input_schema: obj({ track: trackField, variation: variationField, pattern: { type: 'string' } })
  },
  {
    name: 'set_notes',
    description:
      'Write the notes of a melodic track (the 808 or any instrument) for one variation, replacing what was there. ' +
      'Each note: step (0-based sixteenth within the pattern; a 2-bar pattern has steps 0–31), midi (60 = middle C, ' +
      '36 = C2, a typical 808 root), length in sixteenths, and slide (808 only: glide from the note sounding just before; ' +
      'that note must end exactly where this one starts). Chords are several notes on the same step. The 808 plays one note at a time.',
    strict: true,
    input_schema: obj({
      track: trackField, variation: variationField,
      notes: { type: 'array', items: obj({ step: { type: 'integer' }, midi: { type: 'integer' }, length: { type: 'integer' }, slide: { type: 'boolean' } }) }
    })
  },
  {
    name: 'add_instrument',
    description:
      'Add a new melodic track. Instruments: 808 (bass), piano, epiano (electric piano), organ, strings, pad, lead, ' +
      'pluck, bell, synthbass, brass, flute. bars is its pattern length: 1, 2 or 4. It starts empty — follow with set_notes, ' +
      'and include it in set_arrangement if the song structure should use it.',
    strict: true,
    input_schema: obj({ instrument: { type: 'string', enum: INSTRUMENTS }, name: { type: 'string' }, bars: { type: 'integer', enum: [1, 2, 4] } })
  },
  {
    name: 'add_drum_lane',
    description: 'Add a drum track playing one drum sound (kick, snare, clap, hat, openhat, perc, tom, rim) from the current kit.',
    strict: true,
    input_schema: obj({ role: { type: 'string', enum: ROLES }, name: { type: 'string' } })
  },
  {
    name: 'set_instrument',
    description: 'Change which instrument a melodic track plays (its notes stay).',
    strict: true,
    input_schema: obj({ track: trackField, instrument: { type: 'string', enum: INSTRUMENTS } })
  },
  {
    name: 'set_drum_kit',
    description: 'Switch every drum track to a kit: trap (Trap 808), boombap, house (909), lofi, live (acoustic-ish), classic.',
    strict: true,
    input_schema: obj({ kit: { type: 'string', enum: KITS } })
  },
  {
    name: 'set_pattern_length',
    description: 'Set how many bars a track\'s patterns last before repeating (1, 2 or 4). Growing repeats the existing pattern.',
    strict: true,
    input_schema: obj({ track: trackField, bars: { type: 'integer', enum: [1, 2, 4] } })
  },
  {
    name: 'switch_variation',
    description: 'In loop mode, switch which variation a track plays (track name, or "all"). Lands on the next bar.',
    strict: true,
    input_schema: obj({ track: { type: 'string' }, variation: variationField })
  },
  {
    name: 'set_arrangement',
    description:
      'Write the whole song structure: the ordered list of sections. In each section list EVERY track that should play ' +
      'and which variation it plays; any track not listed is silent in that section. muted_bars (1-based bar numbers ' +
      'within the section) silences a track for just those bars — e.g. the snare drops out for bars 7 and 8. solo:true ' +
      'means only soloed tracks are heard in that section. play_song switches the studio to song mode.',
    strict: true,
    input_schema: obj({
      sections: {
        type: 'array',
        items: obj({
          name: { type: 'string' },
          bars: { type: 'integer' },
          tracks: {
            type: 'array',
            items: obj({ track: trackField, variation: variationField, muted_bars: { type: 'array', items: { type: 'integer' } }, solo: { type: 'boolean' } })
          }
        })
      },
      play_song: { type: 'boolean' }
    })
  },
  {
    name: 'set_sound_param',
    description:
      'Turn a knob on a melodic track. The available knobs and their current values are listed per track in the song ' +
      'description. 808 knobs: punchRatio 1–10, punchTime 0.005–0.15s, decay/release seconds, sustain 0–1, drive 1–20 ' +
      '(higher is louder on phone speakers), tone 200–6000Hz. Other instruments: tone/vibrato/width 0–1, attack/release seconds.',
    strict: true,
    input_schema: obj({ track: trackField, param: { type: 'string' }, value: { type: 'number' } })
  },
  {
    name: 'set_swing',
    description: 'Swing for the whole song: 0 is straight, 0.15 a light bounce, 0.3 a lazy shuffle, 0.6 maximum.',
    strict: true,
    input_schema: obj({ amount: { type: 'number' } })
  },
  {
    name: 'set_key',
    description: 'Set the song\'s key (used for the piano roll\'s highlighting and chords). root is 0–11 (0 = C, 9 = A); scale "major" or "minor", or "none" to clear.',
    strict: true,
    input_schema: obj({ root: { type: 'integer' }, scale: { type: 'string', enum: ['major', 'minor', 'none'] } })
  },
  {
    name: 'set_pump',
    description: 'Sidechain pump: duck a track every time a kick hits, 0 (off) to 0.9 (heavy). Typical on pads, chords and bass in house and EDM.',
    strict: true,
    input_schema: obj({ track: trackField, amount: { type: 'number' } })
  },
  {
    name: 'mute_track',
    description: 'Mute or unmute a track everywhere (its mixer mute).',
    strict: true,
    input_schema: obj({ track: trackField, muted: { type: 'boolean' } })
  },
  {
    name: 'set_track_volume',
    description: 'Set a track\'s mixer volume: 0 silent, 0.85 normal, 1.5 maximum.',
    strict: true,
    input_schema: obj({ track: trackField, volume: { type: 'number' } })
  }
];

const SYSTEM = `You are the producer sitting next to someone making a track in BHS Studio.

You have real control: your tool calls change their song directly. Use them rather than describing what to click.

How the studio works:
- Tracks: each drum sound is its own track (Kick, Snare, Hi-hat …); melodic tracks play an instrument (808, piano,
  strings …); audio tracks are recorded or uploaded clips you can't edit, only arrange.
- Every drum/melodic track has four patterns, A–D, each 1, 2 or 4 bars long.
- Sections: the song is a list of sections. For each track, a section says which pattern it plays (or silent),
  can silence it for particular bars, and can solo tracks. So a hook can be Kick B + Clap C + Hat B while the 808
  drops out for its last bar.
- Two modes: loop mode loops each track's current pattern; song mode plays the sections in order.

How to work:
- Make the change. Don't ask permission for ordinary edits.
- Change only what was asked. "Busier hats in the hook" means the hat pattern used in the hook — not the kick.
- To make a part different in one section, write a new variation (B, C or D) and point that section at it, rather than
  editing a variation other sections still use.
- set_arrangement replaces the whole structure, so carry over every section and track you aren't changing.
- Build new parts from what's there — a chorus is usually the verse with more going on.
- Musical defaults: kick on 0 and around 6/10, snare on 4 and 12, hats on eighths or sixteenths. Trap sits near
  130–150 BPM with sparse kicks and rolling hats; boom bap near 85–95.
- If something can't be done with these tools, say so in one sentence and do the closest thing you can.

Then tell them what you changed in one or two plain sentences. No jargon, no tool names.`;

const L = (v) => (v >= 0 ? VARIATIONS[v] : 'off');

/** One drum step in the set_drum_pattern notation. */
function stepChar(v) {
  if (!v) return '.';
  if (v === true) return 'x';
  const roll = Math.floor(v / 10), level = v % 10;
  if (roll > 1) return String(roll);
  return level === 3 ? 'X' : level === 1 ? 'o' : 'x';
}

/** Describe the current song so Claude edits what's actually there. */
function describeState(state) {
  if (!state || !Array.isArray(state.tracks)) return 'The project state was not provided.';
  const lines = [];
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  lines.push(`Tempo: ${state.bpm} BPM. Mode: ${state.mode === 'song' ? 'song' : 'loop'}. Drum kit: ${state.kit}. ` +
    `Swing: ${Math.round((state.swing || 0) * 100)}%. Key: ${state.key ? NOTE[state.key.root] + ' ' + state.key.scale : 'not set'}.`);
  const byId = {};
  state.tracks.forEach(t => { byId[t.id] = t; });

  lines.push('\nTracks:');
  state.tracks.forEach(t => {
    const mix = (state.mixer && state.mixer.tracks && state.mixer.tracks[t.id]) || {};
    const mixNote = `vol ${(mix.volume == null ? 0.85 : mix.volume).toFixed(2)}${mix.muted ? ', MUTED' : ''}${mix.soloed ? ', SOLO' : ''}`;
    if (t.kind === 'drum') {
      lines.push(`- "${t.name}": drum (${t.sound.role}, ${t.sound.kit} kit), ${t.bars}-bar patterns, ${mixNote}, loop plays ${L(t.live)}`);
      (t.patterns || []).forEach((p, v) => {
        if ((p || []).some(Boolean)) lines.push(`    ${VARIATIONS[v]}: ${p.map(stepChar).join('')}`);
        else lines.push(`    ${VARIATIONS[v]}: empty`);
      });
    } else if (t.kind === 'synth') {
      const knobs = Object.entries(t.params || {}).filter(([k]) => k !== 'gain')
        .map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`).join(', ');
      lines.push(`- "${t.name}": ${t.instrument}, ${t.bars}-bar patterns, ${mixNote}${t.pump ? ', pump ' + t.pump : ''}, loop plays ${L(t.live)}; knobs: ${knobs}`);
      (t.patterns || []).forEach((p, v) => {
        const notes = (p || []).slice().sort((a, b) => a.s - b.s || a.m - b.m)
          .map(n => `${n.s}:${n.m}x${n.l}${n.sl ? 's' : ''}`).join(' ');
        lines.push(`    ${VARIATIONS[v]}: ${notes || 'empty'}`);
      });
    } else {
      lines.push(`- "${t.name}": audio clip, loops every ${t.bars} bars, ${mixNote}`);
    }
  });
  lines.push('  (drum steps use the set_drum_pattern notation; notes are step:midi x length, s = slides in)');

  lines.push('\nSections, in order:');
  (state.sections || []).forEach(s => {
    const parts = [];
    state.tracks.forEach(t => {
      const cells = (s.cells || {})[t.id] || [];
      const on = cells.filter(v => v >= 0);
      if (!on.length) return;
      const counts = {};
      on.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      const main = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const muted = cells.map((v, i) => (v < 0 ? i + 1 : null)).filter(Boolean);
      const other = cells.map((v, i) => (v >= 0 && v !== main ? `${i + 1}=${L(v)}` : null)).filter(Boolean);
      let txt = `${t.name} ${L(main)}`;
      if (muted.length) txt += ` (silent bars ${muted.join(',')})`;
      if (other.length) txt += ` (bars ${other.join(',')})`;
      parts.push(txt);
    });
    const solo = (s.solo || []).map(id => byId[id] && byId[id].name).filter(Boolean);
    lines.push(`- ${s.name}, ${s.bars} bars: ${parts.join('; ') || 'nothing plays'}${solo.length ? ` — SOLO: ${solo.join(', ')}` : ''}`);
  });
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

    // Server-side fallback: if a safety classifier declines (false positives
    // happen on music words like "killer drop"), the API re-runs the request
    // on Anthropic's recommended fallback model instead of returning nothing.
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      tools: TOOLS,
      messages: [{
        role: 'user',
        content: `Here is the song right now:\n\n${describeState(body.state)}\n\nWhat they asked for: ${message}`
      }]
    });

    if (response.stop_reason === 'refusal') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reply: 'I couldn\'t do that one — try wording it differently.', actions: [], stopReason: 'refusal' }));
    }

    const actions = [];
    let reply = '';
    for (const block of response.content) {
      if (block.type === 'text') reply += block.text;
      else if (block.type === 'tool_use') actions.push({ name: block.name, input: block.input });
    }
    // A tool call cut off by the token limit may be incomplete — don't apply it.
    if (response.stop_reason === 'max_tokens') actions.length = 0;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reply: reply.trim(), actions, stopReason: response.stop_reason }));
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

module.exports = { handleStudioAssist, describeState, TOOLS, VARIATIONS, INSTRUMENTS };
