// studio-midi.js — what a MIDI keyboard plays.
//
// midi.js delivers notes; this decides where they go. Everything goes through
// the dock's Keys API — the same path the on-screen keys use — so a MIDI note
// gets voice limits, the 808 slide, the key lighting up, and "Write notes"
// recording for free.
//
// Targets:
//   dock          whatever the on-screen keys are set to (the default)
//   drums         drum pads — General MIDI drum notes if your controller sends
//                 them, otherwise consecutive keys up from C2, one per lane
//   track:<id>    a specific instrument (also switches the dock to it)

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
  let targetId = 'dock';
  let sustainHeld = false;
  const sustained = new Set();

  document.getElementById('midiBtn').addEventListener('click', (e) => App.togglePop(document.getElementById('midiMenu'), e.currentTarget));

  // General MIDI drum notes → drum role.
  const GM = {
    35: 'kick', 36: 'kick', 38: 'snare', 40: 'snare', 37: 'rim', 39: 'clap',
    42: 'hat', 44: 'hat', 46: 'openhat', 54: 'perc', 70: 'perc', 82: 'perc', 69: 'perc',
    41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom'
  };
  const FALLBACK_LOW = 36;

  function drumFor(midi) {
    const lanes = Keys.drumTracks();
    if (midi in GM) {
      const t = lanes.find(l => l.sound.role === GM[midi]);
      if (t) return t;
    }
    return lanes[midi - FALLBACK_LOW] || null;
  }

  const say = (t) => { activityEl.textContent = t; };
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = (m) => NOTE[m % 12] + (Math.floor(m / 12) - 1);

  function drumMode() {
    return targetId === 'drums' || Keys.target() === 'drums';
  }

  function noteOn(midi, vel) {
    if (drumMode()) {
      const t = drumFor(midi);
      if (!t) { say('note ' + midi + ' — no drum on that key'); return false; }
      return Keys.hitDrum(t.id, vel);
    }
    return Keys.noteOn(midi, vel);
  }
  function noteOff(midi) { if (!drumMode()) Keys.noteOff(midi); }

  MidiIn.onNote((n) => {
    if (channel && n.channel !== channel) return;
    if (n.on) {
      sustained.delete(n.midi);
      const res = noteOn(n.midi, useVelocity ? n.velocity : 0.8);
      if (res !== false) say(`${name(n.midi)}  ·  vel ${n.rawVelocity}`);
      activityEl.classList.add('lit');
      setTimeout(() => activityEl.classList.remove('lit'), 120);
    } else {
      if (sustainHeld) { sustained.add(n.midi); return; }
      noteOff(n.midi);
    }
  });

  MidiIn.onControl((c) => {
    if (channel && c.channel !== channel) return;
    if (c.cc !== 64) return;                       // sustain pedal
    const down = c.rawValue >= 64;
    if (down === sustainHeld) return;
    sustainHeld = down;
    if (!down) { sustained.forEach(noteOff); sustained.clear(); }
    say(down ? 'pedal down' : 'pedal up');
  });

  MidiIn.onBend((b) => {
    if (channel && b.channel !== channel) return;
    Keys.setBend(b.value * 2);                     // ±2 semitones, the usual default
  });

  MidiIn.onDevices((list) => renderDevices(list));

  function renderDevices(list) {
    devicesEl.innerHTML = '';
    if (!list.length) { devicesEl.textContent = 'No keyboard detected.'; return; }
    list.forEach(d => {
      const b = document.createElement('span');
      b.className = 'chipline';
      b.textContent = d.name + (d.manufacturer ? ' (' + d.manufacturer + ')' : '');
      devicesEl.appendChild(b);
    });
  }

  function buildTargets() {
    const keep = targetSel.value || targetId;
    targetSel.innerHTML = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      targetSel.appendChild(o);
    };
    add('dock', 'Same as the on-screen keys');
    add('drums', 'Drum pads');
    Keys.synthTracks().forEach(t => add('track:' + t.id, t.name + ' (' + Instruments.label(t.instrument) + ')'));
    targetSel.value = Array.from(targetSel.options).some(o => o.value === keep) ? keep : 'dock';
    targetId = targetSel.value.startsWith('track:') ? 'dock' : targetSel.value;
  }

  function setTarget(value) {
    releaseAll();
    if (value.startsWith('track:')) {
      Keys.setTarget(value.slice(6));
      targetId = 'dock';
    } else {
      targetId = value;
    }
    save();
    const hints = {
      dock: 'Plays whatever the keyboard dock is set to. Velocity, the sustain pedal and the pitch wheel all work.',
      drums: 'Each key is a drum lane. A pad controller works as-is (General MIDI notes); on a piano keyboard it is one lane per key up from C2.'
    };
    statusEl.textContent = hints[targetId] || '';
    statusEl.classList.remove('bad');
  }

  function releaseAll() {
    Keys.allOff();
    sustained.clear();
    sustainHeld = false;
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ target: targetSel.value, channel, useVelocity })); } catch (_) {}
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!d) return;
      if (d.target && Array.from(targetSel.options).some(o => o.value === d.target)) { targetSel.value = d.target; setTarget(d.target); }
      if (typeof d.channel === 'number') { channel = d.channel; channelSel.value = String(channel); }
      if (typeof d.useVelocity === 'boolean') { useVelocity = d.useVelocity; velChk.checked = useVelocity; }
    } catch (_) { /* a corrupt setting just doesn't stick */ }
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    statusEl.textContent = 'Asking the browser for MIDI…';
    App.ensureAudio();
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
  channelSel.addEventListener('change', () => { channel = parseInt(channelSel.value, 10) || 0; save(); });
  velChk.addEventListener('change', () => { useVelocity = velChk.checked; save(); });
  window.addEventListener('blur', releaseAll);
  Project.on((r) => { if (r === 'tracks' || r === 'load' || r === 'sound') buildTargets(); });

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

  window.__bhsMidiTarget = () => ({ targetId, dock: Keys.target(), channel, useVelocity });
})();
