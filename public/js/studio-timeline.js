// studio-timeline.js — the draggable timeline UI.
//
// Placement, move and trim are all pointer-drag with live snap-to-bar, the
// same interaction CapCut and BandLab use for clips on a track.

(function () {
  const libEl = document.getElementById('sampleLib');
  const upload = document.getElementById('sampleUpload');
  const tracksEl = document.getElementById('timelineTracks');
  const rulerEl = document.getElementById('timelineRuler');
  const loopChk = document.getElementById('timelineLoop');
  const msgEl = document.getElementById('timelineMsg');
  if (!tracksEl || typeof SampleTimeline === 'undefined') return;

  const BAR_PX = 28;
  let armedSampleId = null;

  function msg(t) { msgEl.textContent = t || ''; }
  function secPerBar() {
    const st = Transport.getState();
    return st.secondsPerStep * st.stepsPerBar;
  }

  upload.addEventListener('change', async () => {
    const files = Array.from(upload.files || []);
    for (const f of files) {
      msg('Loading ' + f.name + '…');
      try {
        const s = await SampleTimeline.addSample(f);
        if (s) armedSampleId = s.id;
      } catch (e) {
        msg('Could not read ' + f.name + ' — is it an audio file?');
      }
    }
    upload.value = '';
    msg(armedSampleId ? 'Click a lane below to place it.' : '');
  });

  function renderRuler() {
    rulerEl.innerHTML = '';
    rulerEl.style.width = (SampleTimeline.TIMELINE_BARS * BAR_PX) + 'px';
    for (let b = 0; b < SampleTimeline.TIMELINE_BARS; b += 4) {
      const t = document.createElement('span');
      t.className = 'ruletick';
      t.style.left = (b * BAR_PX) + 'px';
      t.textContent = String(b + 1);
      rulerEl.appendChild(t);
    }
  }

  function renderLibrary() {
    const lib = SampleTimeline.getLibrary();
    libEl.innerHTML = '';
    if (!lib.length) { libEl.textContent = 'No samples uploaded yet.'; return; }
    lib.forEach(s => {
      const b = document.createElement('button');
      b.className = 'libitem' + (s.id === armedSampleId ? ' armed' : '');
      b.textContent = `${s.name} (${s.duration.toFixed(1)}s)`;
      b.title = 'Click, then click a lane to place it';
      b.addEventListener('click', () => { armedSampleId = s.id; renderLibrary(); msg('Click a lane to place ' + s.name + '.'); });
      libEl.appendChild(b);
    });
  }

  function renderTracks() {
    const clips = SampleTimeline.getClips();
    const lib = SampleTimeline.getLibrary();
    tracksEl.innerHTML = '';
    tracksEl.style.width = (SampleTimeline.TIMELINE_BARS * BAR_PX) + 'px';

    for (let t = 0; t < SampleTimeline.TRACKS; t++) {
      const lane = document.createElement('div');
      lane.className = 'tlane';
      lane.style.width = (SampleTimeline.TIMELINE_BARS * BAR_PX) + 'px';

      lane.addEventListener('click', (e) => {
        if (e.target !== lane) return;   // ignore clicks that landed on a clip
        if (armedSampleId == null) { msg('Pick a sample from the library first.'); return; }
        const rect = lane.getBoundingClientRect();
        const bar = Math.max(0, Math.round((e.clientX - rect.left) / BAR_PX));
        SampleTimeline.addClip(armedSampleId, t, bar, secPerBar());
      });

      clips.filter(c => c.track === t).forEach(c => {
        const sample = lib.find(s => s.id === c.sampleId);
        const el = document.createElement('div');
        el.className = 'clip';
        el.style.left = (c.startBar * BAR_PX) + 'px';
        el.style.width = (c.lengthBars * BAR_PX - 2) + 'px';
        el.title = sample ? sample.name : '(missing sample)';

        const label = document.createElement('span');
        label.className = 'cliplabel';
        label.textContent = sample ? sample.name : '?';
        el.appendChild(label);

        const del = document.createElement('button');
        del.className = 'clipdel';
        del.textContent = '×';
        del.addEventListener('click', (e) => { e.stopPropagation(); SampleTimeline.removeClip(c.id); });
        el.appendChild(del);

        const handle = document.createElement('div');
        handle.className = 'cliphandle';
        el.appendChild(handle);

        wireDrag(el, handle, c, t);
        lane.appendChild(el);
      });

      tracksEl.appendChild(lane);
    }
  }

  /** Drag the body to move; drag the right-edge handle to trim. */
  function wireDrag(el, handle, clip, trackIndex) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;
      e.stopPropagation();
      const startX = e.clientX;
      const startBar = clip.startBar;
      const laneEl = el.parentElement;
      const laneRect = laneEl.getBoundingClientRect();
      const laneIndex = () => Array.from(tracksEl.children).indexOf(laneEl);

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const newBar = Math.max(0, startBar + Math.round(dx / BAR_PX));
        el.style.left = (newBar * BAR_PX) + 'px';
        el.dataset.pendingBar = String(newBar);

        // Track switching: which lane is the pointer over vertically.
        const y = ev.clientY;
        let overIdx = laneIndex();
        Array.from(tracksEl.children).forEach((ln, i) => {
          const r = ln.getBoundingClientRect();
          if (y >= r.top && y <= r.bottom) overIdx = i;
        });
        el.dataset.pendingTrack = String(overIdx);
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const newBar = parseInt(el.dataset.pendingBar || String(clip.startBar), 10);
        const newTrack = parseInt(el.dataset.pendingTrack || String(trackIndex), 10);
        SampleTimeline.moveClip(clip.id, newTrack, newBar);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startLen = clip.lengthBars;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const newLen = Math.max(1, startLen + Math.round(dx / BAR_PX));
        el.style.width = (newLen * BAR_PX - 2) + 'px';
        el.dataset.pendingLen = String(newLen);
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        SampleTimeline.trimClip(clip.id, parseInt(el.dataset.pendingLen || String(clip.lengthBars), 10));
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  loopChk.addEventListener('change', () => SampleTimeline.setLoopTimeline(loopChk.checked));

  SampleTimeline.onChange((snap) => {
    renderLibrary();
    renderTracks();
    loopChk.checked = snap.loopTimeline;
  });

  SampleTimeline.init();
  Transport.onStep((ev) => SampleTimeline.onStep(ev));

  window.addEventListener('bhs:collect-timeline', (e) => { e.detail.timeline = SampleTimeline.serialize(); });
  window.addEventListener('bhs:apply-timeline', (e) => { SampleTimeline.restore(e.detail.timeline); });

  renderRuler();
  renderLibrary();
  renderTracks();
})();
