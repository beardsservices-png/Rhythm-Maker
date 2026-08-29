// midi.js — talk to a real MIDI keyboard.
//
// This file knows about hardware and nothing about instruments. It turns the
// raw three-byte messages a keyboard sends into plain events — note on, note
// off, pedal, bend — and hands them to whoever registered a callback. What
// those events then *play* is studio-midi.js's problem, which is what makes
// "assign the keyboard to something else" a one-line change there rather than
// a rewrite here.
//
// TIMING. Every other scheduled thing in the studio (transport.js, the drum
// lanes, the sample timeline) is deliberately scheduled AHEAD of now against
// the audio clock. This is the opposite case and wants the opposite treatment.
// A MIDIMessageEvent carries a timeStamp, but it is in the performance.now()
// domain, not audioContext.currentTime — there is no exact conversion, only an
// estimate that drifts. And a note a person is playing by hand has no
// "correct" time to land on: it should sound the instant they press the key.
// So notes fire at currentTime and nothing here tries to be clever about it.
//
// BROWSER SUPPORT, honestly. Chrome and Edge on a desktop are the target.
// Safari has no Web MIDI at all, which means iPhone and iPad cannot do this —
// including Chrome on iOS, which is Safari underneath. Firefox has it behind a
// permission prompt. And it requires a secure context: the Railway https URL
// and localhost work, a LAN address like 192.168.1.50:8080 does not, silently.
// enable() reports which of those walls it hit so the UI can say so in English.

const MidiIn = (() => {
  let access = null;
  let enabled = false;
  let boundInputs = new Set();

  const noteFns = new Set();
  const ctrlFns = new Set();
  const bendFns = new Set();
  const deviceFns = new Set();

  const onNote    = (fn) => { noteFns.add(fn);   return () => noteFns.delete(fn); };
  const onControl = (fn) => { ctrlFns.add(fn);   return () => ctrlFns.delete(fn); };
  const onBend    = (fn) => { bendFns.add(fn);   return () => bendFns.delete(fn); };
  const onDevices = (fn) => { deviceFns.add(fn); return () => deviceFns.delete(fn); };

  function fire(set, payload) {
    set.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  function supported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }

  /** A secure context is required, and its absence is the likeliest real-world snag. */
  function secure() {
    return window.isSecureContext !== false;
  }

  /**
   * Ask the browser for MIDI. Must be called from a click: it may prompt for
   * permission, and it is also the right moment to wake the AudioContext.
   *
   * Resolves to { ok, reason, message } rather than throwing, because every
   * failure here is something the person at the keyboard needs told plainly.
   */
  async function enable() {
    if (!secure()) {
      return { ok: false, reason: 'insecure', message:
        'MIDI only works on a secure address. Open the app at its https:// web address — ' +
        'a home-network address like 192.168.1.50 will not work, no matter what you try.' };
    }
    if (!supported()) {
      return { ok: false, reason: 'unsupported', message:
        'This browser has no MIDI support. Use Chrome or Edge on a computer — ' +
        'Safari has none at all, so iPhone and iPad cannot do this.' };
    }
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      return { ok: false, reason: 'denied', message:
        'The browser refused MIDI access. If you saw a permission box, choose Allow ' +
        'and click Connect again.' };
    }

    enabled = true;
    // Keyboards get plugged in after the page has loaded far more often than
    // before it. Without this, the honest-looking answer is "no devices found".
    access.onstatechange = () => { bindAll(); fire(deviceFns, devices()); };
    bindAll();
    fire(deviceFns, devices());

    const list = devices();
    return list.length
      ? { ok: true, message: 'Connected: ' + list.map(d => d.name).join(', ') }
      : { ok: true, message: 'MIDI is on, but no keyboard is plugged in yet. ' +
                             'Plug one in — it will be picked up straight away.' };
  }

  function bindAll() {
    if (!access) return;
    access.inputs.forEach(input => {
      if (boundInputs.has(input.id)) return;
      input.onmidimessage = handle;
      boundInputs.add(input.id);
    });
    // Forget anything unplugged, so replugging rebinds it.
    const live = new Set();
    access.inputs.forEach(i => live.add(i.id));
    boundInputs.forEach(id => { if (!live.has(id)) boundInputs.delete(id); });
  }

  function devices() {
    if (!access) return [];
    const out = [];
    access.inputs.forEach(i => out.push({
      id: i.id, name: i.name || 'Unnamed keyboard',
      manufacturer: i.manufacturer || '', state: i.state
    }));
    return out;
  }

  // ── message parsing ─────────────────────────────────────────────────
  //
  // Status byte: high nibble is the command, low nibble the channel (0-15,
  // shown to people as 1-16).

  const NOTE_OFF = 0x80, NOTE_ON = 0x90, CONTROL = 0xB0, BEND = 0xE0;

  function handle(ev) {
    const d = ev.data;
    if (!d || d.length < 2) return;               // clock/sensing bytes, ignored
    const cmd = d[0] & 0xF0;
    const channel = (d[0] & 0x0F) + 1;

    if (cmd === NOTE_ON || cmd === NOTE_OFF) {
      const midi = d[1];
      const raw = d.length > 2 ? d[2] : 0;
      // A note-on with velocity 0 IS a note-off — most keyboards send it that
      // way rather than 0x80, so missing this leaves every note hanging on.
      const on = cmd === NOTE_ON && raw > 0;
      fire(noteFns, { midi, on, channel, rawVelocity: raw, velocity: raw / 127 });
      return;
    }

    if (cmd === CONTROL) {
      fire(ctrlFns, { cc: d[1], value: (d.length > 2 ? d[2] : 0) / 127, channel,
                      rawValue: d.length > 2 ? d[2] : 0 });
      return;
    }

    if (cmd === BEND) {
      // 14-bit, LSB first, centred at 8192. Reported as -1..+1 so the caller
      // decides the range in semitones.
      const value = ((d[2] << 7) | d[1]) - 8192;
      fire(bendFns, { value: value / 8192, channel });
    }
  }

  return {
    supported, secure, enable, devices,
    isEnabled: () => enabled,
    onNote, onControl, onBend, onDevices,
    // Exposed so the browser test can push real message bytes through the
    // real parser without any hardware in the way.
    __handle: handle
  };
})();
