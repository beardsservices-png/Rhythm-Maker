// studio-midi.js — what the MIDI keyboard actually plays.
//
// midi.js delivers notes; this decides where they go. Every destination is a
// TARGET with the same tiny shape — noteOn(midi, velocity), noteOff(midi) — so
// "assign the keyboard to the drums instead of the 808" is a dropdown, not a
// code path. Adding a fifth instrument later means adding one entry here.
//
// Nothing plays audio directly. The 808 goes through the bhs:note-on event so
// it inherits voice stealing, the slide and the on-screen key lighting up; the
// drums go through bhs:trigger-drum so a played hit lands on the same mixer
// strip as a sequenced one. The only voice this module owns is the pitched
// synth, because nothing else in the studio plays those.

(function () {
  const panel = document.getElementById('midiPanel');
  if (!panel || typeof MidiIn === 'undefined') return;

  const connectBtn = document.getElementById('midiConnect');
  const statusEl   = document.getElementById('midiStatus');
  const devicesEl  = document.getElementById('midiDevices');
  const targetSel  = document.getElementById('midiTarget');
  const channelSel = document.getElementById('midiChannel');
  const velChk     = document.getElementById('midiVelocity');
  const activityEl = document.getElementById('midiActivity');

  const STORE = 'bhs.midi.setup';

  let channel = 0;            // 0 = all
  let useVelocity = true;
  let targetId = 'bass808';
  let sustainHeld = false;
  const sustained = new Set();  // notes the pedal is holding past their key-up

  // ── the pitched synth target's own audio ────────────────────────────
  //
  // Same pattern studio-drums.js uses: its own dry/wet chain feeding its own
  // mixer strip, so it gets a fader, pan and the shared reverb/delay sends.
  let synthBuses = null;
  let synthVoice = 'lead_pluck';

  function ensureSynth() {
    if (synthBuses) return synthBuses;
    const ac = Synth808.ensureContext();
    if (!ac || typeof RhythmAudio === 'undefined') return null;
    RhythmAudio.adoptContext(ac);
    Mixer.init(ac);
    Mixer.addTrack('midi', 'MIDI synth', { volume: 0.8 });
    synthBuses = RhythmAudio.createBuses(ac);
    synthBuses.output.connect(Mixer.input('midi'));
    return synthBuses;
  }

  // ── drum note mapping ───────────────────────────────────────────────
  //
  // Two maps on purpose. A real drum controller sends the General MIDI notes,
  // so honouring those means a pad controller works with no setup at all. A
  // plain piano keyboard sends none of them, so six contiguous keys from C2
  // are the fallback — whichever the note matches, it plays.
  //
  // Lane order matches studio-drums.js: kick, snare, hat, open hat, clap, shaker.
  const GM_DRUMS = {
    35: 0, 36: 0,            // kicks
    38: 1, 40: 1,            // snares
    42: 2, 44: 2,            // closed / pedal hat
    46: 3,                   // open hat
    39: 4,                   // clap
    70: 5, 82: 5, 54: 5      // shaker / tambourine
  };
  const FALLBACK_LOW = 36;   // C2 upward, six keys

  function drumLane(midi) {
    if (midi in GM_DRUMS) return GM_DRUMS[midi];
    const i = midi - FALLBACK_LOW;
    return (i >= 0 && i < 6) ? i : null;
  }

  // ── targets ─────────────────────────────────────────────────────────

  const say = (t) => { activityEl.textContent = t; };

  const TARGETS = {
    bass808: {
      label: '808 bass',
      noteOn(midi, velocity) {
        window.dispatchEvent(new CustomEvent('bhs:note-on', { detail: { midi, velocity } }));
      },
      noteOff(midi) {
        window.dispatchEvent(new CustomEvent('bhs:note-off', { detail: { midi } }));
      },
      bend(semis) {
        window.dispatchEvent(new CustomEvent('bhs:bend', { detail: { semitones: semis } }));
      }
    },

    drums: {
      label: 'Drum pads',
      noteOn(midi) {
        const lane = drumLane(midi);
        if (lane == null) { say('note ' + midi + ' — no drum on that key'); return false; }
        window.dispatchEvent(new CustomEvent('bhs:trigger-drum', { detail: { lane } }));
      },
      noteOff() { /* drums are one-shots */ }
    },

    samples: {
      label: 'Sample pads',
      noteOn(midi) {
        if (typeof SampleTimeline === 'undefined') return false;
        const lib = SampleTimeline.getLibrary();
        if (!lib.length) { say('no samples uploaded yet'); return false; }
        const i = midi - 48;                      // C3 upward, one key per sample
        if (i < 0 || i >= lib.length) { say('note ' + midi + ' — no sample on that key'); return false; }
        SampleTimeline.triggerSample(lib[i].id, i % SampleTimeline.TRACKS);
      },
      noteOff() { /* one-shots */ }
    },

    synth: {
      label: 'Synth voice',
      noteOn(midi) {
        const buses = ensureSynth();
        if (!buses) return false;
        const ac = Synth808.ensureContext();
        RhythmAudio.renderVoicePitched(ac, buses, synthVoice, ac.currentTime, midi);
        // These voices take no velocity of their own, and turning the mixer
        // strip down per-note would fight the fader. So velocity is ignored
        // here rather than faked; the 808 target does honour it.
      },
      noteOff() { /* fixed decay, no note-off — see renderVoicePitched */ }
    }
  };

  function target() { return TARGETS[targetId] || TARGETS.bass808; }

  // ── incoming ────────────────────────────────────────────────────────

  MidiIn.onNote((n) => {
    if (channel && n.channel !== channel) return;
    const t = target();

    if (n.on) {
      sustained.delete(n.midi);
      const vel = useVelocity ? n.velocity : 0.8;
      const res = t.noteOn(n.midi, vel);
      if (res !== false) {
        say(`${Synth808.midiToName(n.midi)}  ·  vel ${n.rawVelocity}`);
      }
      activityEl.classList.add('lit');
      setTimeout(() => activityEl.classList.remove('lit'), 120);
    } else {
      // With the pedal down the key coming up isn't the note ending.
      if (sustainHeld) { sustained.add(n.midi); return; }
      t.noteOff(n.midi);
    }
  });

  MidiIn.onControl((c) => {
    if (channel && c.channel !== channel) return;
    if (c.cc === 64) {                      // sustain pedal
      const down = c.rawValue >= 64;
      if (down === sustainHeld) return;
      sustainHeld = down;
      if (!down) {
        const t = target();
        sustained.forEach(m => t.noteOff(m));
        sustained.clear();
      }
      say(down ? 'pedal down' : 'pedal up');
    }
  });

  MidiIn.onBend((b) => {
    if (channel && b.channel !== channel) return;
    const t = target();
    if (t.bend) t.bend(b.value * 2);        // ±2 semitones, the usual default
  });

  MidiIn.onDevices((list) => renderDevices(list));

  // ── UI ──────────────────────────────────────────────────────────────

  function renderDevices(list) {
    devicesEl.innerHTML = '';
    if (!list.length) { devicesEl.textContent = 'No keyboard detected.'; return; }
    list.forEach(d => {
      const b = document.createElement('span');
      b.className = 'libitem';
      b.textContent = d.name + (d.manufacturer ? ' (' + d.manufacturer + ')' : '');
      devicesEl.appendChild(b);
    });
  }

  function buildTargets() {
    targetSel.innerHTML = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      targetSel.appendChild(o);
    };
    add('bass808', '808 bass');
    add('drums', 'Drum pads');
    add('samples', 'Sample pads');
    if (typeof RhythmAudio !== 'undefined' && RhythmAudio.pitchedVoices) {
      RhythmAudio.pitchedVoices().forEach(v => add('synth:' + v.id, v.label));
    }
    targetSel.value = 'bass808';
  }

  function setTarget(value) {
    // Anything still sounding belongs to the old target — let it go before
    // switching, or those notes can never be released.
    releaseAll();
    if (value.startsWith('synth:')) {
      synthVoice = value.slice(6);
      targetId = 'synth';
    } else {
      targetId = value;
    }
    save();
    const hints = {
      bass808: 'Playing the 808. Velocity, the sustain pedal and the pitch wheel all work.',
      drums:   'Each key is a drum. A pad controller works as-is; on a piano keyboard it is six keys up from C2.',
      samples: 'One uploaded clip per key, from C3 upward. Upload them in the Sample timeline above.',
      synth:   'A one-shot voice — it fades on its own rather than holding while you press the key.'
    };
    statusEl.textContent = hints[targetId] || '';
  }

  function releaseAll() {
    window.dispatchEvent(new CustomEvent('bhs:all-notes-off'));
    sustained.clear();
    sustainHeld = false;
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        target: targetSel.value, channel, useVelocity
      }));
    } catch (_) { /* private browsing — the setup just won't stick */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.target && Array.from(targetSel.options).some(o => o.value === d.target)) {
        targetSel.value = d.target;
        setTarget(d.target);
      }
      if (typeof d.channel === 'number') { channel = d.channel; channelSel.value = String(channel); }
      if (typeof d.useVelocity === 'boolean') { useVelocity = d.useVelocity; velChk.checked = useVelocity; }
    } catch (_) { /* ignore a corrupt or unreadable setting */ }
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    statusEl.textContent = 'Asking the browser for MIDI…';
    // The click is also the gesture that lets audio start.
    Synth808.ensureContext();
    const res = await MidiIn.enable();
    statusEl.textContent = res.message;
    statusEl.classList.toggle('bad', !res.ok);
    if (res.ok) {
      connectBtn.textContent = 'Connected';
      renderDevices(MidiIn.devices());
    } else {
      connectBtn.disabled = false;
    }
  });

  targetSel.addEventListener('change', () => setTarget(targetSel.value));
  channelSel.addEventListener('change', () => {
    channel = parseInt(channelSel.value, 10) || 0;
    save();
  });
  velChk.addEventListener('change', () => { useVelocity = velChk.checked; save(); });

  // Losing the window mid-note would otherwise leave it sounding forever.
  window.addEventListener('blur', releaseAll);

  buildTargets();
  load();

  if (!MidiIn.secure()) {
    connectBtn.disabled = true;
    statusEl.textContent = 'This page is not on a secure address, so the browser will not allow MIDI. ' +
      'Open the app at its https:// web address — a home-network address like 192.168.1.50 cannot work.';
    statusEl.classList.add('bad');
  } else if (!MidiIn.supported()) {
    connectBtn.disabled = true;
    statusEl.textContent = 'This browser has no MIDI support. Use Chrome or Edge on a computer — ' +
      'Safari has none, so iPhone and iPad cannot do this.';
    statusEl.classList.add('bad');
  }

  // For the browser test: which target is live, without scraping the DOM.
  window.__bhsMidiTarget = () => ({ targetId, synthVoice, channel, useVelocity });
})();
