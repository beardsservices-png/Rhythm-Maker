// wav.js — encode an AudioBuffer to a WAV file and back.
//
// Needed twice over: recorded loops have to persist as real audio files
// alongside the project JSON (megabytes of PCM base64'd into JSON would
// inflate ~33% and force a rewrite of the whole document on every save), and
// the same encoder is what turns an offline render into a downloadable mix.
//
// 16-bit PCM: universally readable, half the size of float32, and the noise
// floor is far below anything that matters here.

const WavCodec = (() => {

  function encode(audioBuffer, { bitDepth = 16 } = {}) {
    const numCh = audioBuffer.numberOfChannels;
    const numFrames = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = numFrames * blockAlign;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    let o = 0;
    const str = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i)); };
    const u32 = (v) => { view.setUint32(o, v, true); o += 4; };
    const u16 = (v) => { view.setUint16(o, v, true); o += 2; };

    str('RIFF'); u32(36 + dataSize); str('WAVE');
    str('fmt '); u32(16); u16(1); u16(numCh);
    u32(sampleRate); u32(sampleRate * blockAlign); u16(blockAlign); u16(bitDepth);
    str('data'); u32(dataSize);

    // Interleave. Read each channel once into a local to avoid re-fetching
    // getChannelData inside the sample loop.
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c));

    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = chans[c][i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        // Asymmetric on purpose: int16 runs -32768..32767, so scaling
        // negatives by 32768 and positives by 32767 avoids wrapping +1.0
        // round to -32768, which reads as a full-scale click.
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        o += 2;
      }
    }
    return buffer;
  }

  function toBlob(audioBuffer, opts) {
    return new Blob([encode(audioBuffer, opts)], { type: 'audio/wav' });
  }

  /** Decode a WAV ArrayBuffer via the browser's own decoder. */
  function decode(ctx, arrayBuffer) {
    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  /**
   * Scale a rendered buffer so its loudest sample sits at `target`.
   *
   * The master chain uses a DynamicsCompressorNode, which has no lookahead and
   * can overshoot — it cannot guarantee the render won't clip. Peak-normalising
   * the finished buffer can, exactly, in one pass.
   */
  function normalize(audioBuffer, target = 0.98) {
    let peak = 0;
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    if (peak === 0 || peak <= target) return { applied: 1, peak };
    const g = target / peak;
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
    return { applied: g, peak };
  }

  return { encode, toBlob, decode, normalize };
})();
