// recorder-worklet.js — continuous capture into a ring buffer.
//
// This runs on the audio thread and must be loaded as its own file via
// audioWorklet.addModule(); it cannot be inlined into a page.
//
// WHY A RING BUFFER RATHER THAN START/STOP RECORDING
//
// The looper is meant to forgive a late punch-in: hit record a moment after
// the bar line and the take should still begin ON the bar. That is only
// possible if the audio from before the button press already exists. A
// recorder that starts when you press it can never snap backwards — it can
// only wait for the next bar, which is a different and worse feel.
//
// So capture runs continuously from the moment a slot is armed, and the
// quantising happens later, by slicing this buffer at computed sample
// offsets. The recorder itself is never started or stopped on the beat.
//
// WHY NOT MediaRecorder
//
// MediaRecorder hands back an encoded container (WebM/Opus in Chrome). To
// loop it you must decodeAudioData it back, and Opus carries an encoder
// pre-skip that offsets the decoded start by an amount that isn't reliably
// exposed. You also get chunks on a timer rather than sample indices, so
// there is no way to cut exactly on a bar. Here every sample has a known
// index, and a bar boundary in seconds converts to one by multiplication.

// Has to hold the longest take anyone can punch in one go, because the slice
// is taken after the fact. 4 bars of 4/4 at 60bpm is 16s; 30s leaves room for
// slower tempos and longer loops. At 48kHz mono that is ~5.8MB, paid once.
// A take longer than this comes back as 'too-old' rather than silently wrong.
const RING_SECONDS = 30;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringLength = Math.ceil(RING_SECONDS * sampleRate);
    this.ring = new Float32Array(this.ringLength);
    this.written = 0;          // total frames ever written
    this.startTime = -1;       // audio-clock time of frame 0
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (!msg || msg.type !== 'slice') return;
    this.port.postMessage(this.slice(msg));
  }

  /**
   * Pull a range out of the ring by audio-clock time.
   * Returns { id, ok, reason?, samples?, sampleRate, startedAt }.
   */
  slice(req) {
    const { id, from, to } = req;
    const base = { id, sampleRate, startedAt: this.startTime };

    if (this.startTime < 0) return Object.assign(base, { ok: false, reason: 'no-capture' });

    const fromIdx = Math.round((from - this.startTime) * sampleRate);
    const toIdx = Math.round((to - this.startTime) * sampleRate);
    const count = toIdx - fromIdx;

    if (count <= 0) return Object.assign(base, { ok: false, reason: 'empty' });
    if (toIdx > this.written) return Object.assign(base, { ok: false, reason: 'future' });

    // Anything older than one ring's worth has already been overwritten.
    const oldest = Math.max(0, this.written - this.ringLength);
    if (fromIdx < oldest) return Object.assign(base, { ok: false, reason: 'too-old' });

    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.ring[(fromIdx + i) % this.ringLength];
    }
    return Object.assign(base, { ok: true, samples: out });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const ch = input[0];
    if (!ch) return true;

    if (this.startTime < 0) this.startTime = currentTime;

    for (let i = 0; i < ch.length; i++) {
      this.ring[(this.written + i) % this.ringLength] = ch[i];
    }
    this.written += ch.length;
    return true;   // keep the node alive even while the mic is silent
  }
}

registerProcessor('bhs-recorder', RecorderProcessor);
