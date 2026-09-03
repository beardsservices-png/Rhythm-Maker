// registry.js — the list Practice Mode picks from.
// Add an instrument: build its module (see flute.js / piano.js), load its
// <script> in practice.html, then add one line here.

const PracticeInstruments = {
  list: [
    FluteInstrument,
    PianoInstrument,
    HandPianoInstrument,
  ],
  byId(id) { return this.list.find(i => i.id === id) || null; },
  default() { return this.list[0]; },
};
