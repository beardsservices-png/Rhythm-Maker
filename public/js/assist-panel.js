// assist-panel.js — shared "Ask Claude" panel wired into a page's transport.
// Renders itself into #assistPanel and calls back into the page via `hooks`:
//   hooks.getContext()      -> plain object describing current pattern state
//   hooks.applyActions(actions) -> apply the small edits Claude proposed
function initAssistPanel(hooks) {
  const el = document.getElementById('assistPanel');
  if (!el) return;

  el.innerHTML = `
    <div class="assist-hdr">Ask Claude <span class="assist-sub">(assists — doesn't build it for you)</span></div>
    <div class="assist-row">
      <input type="text" id="assistInput" placeholder="e.g. 'make the hi-hats busier' or 'what's swing?'" autocomplete="off">
      <button id="assistSend">Ask</button>
    </div>
    <div id="assistReply" class="assist-reply"></div>
  `;

  const input = el.querySelector('#assistInput');
  const sendBtn = el.querySelector('#assistSend');
  const reply = el.querySelector('#assistReply');

  async function send() {
    const instruction = input.value.trim();
    if (!instruction) return;
    sendBtn.disabled = true;
    reply.textContent = 'Thinking…';
    reply.classList.add('show');

    const context = hooks.getContext ? hooks.getContext() : {};
    const result = await RhythmAssist.ask(instruction, context);

    if (!result.ok) {
      reply.textContent = result.error;
    } else {
      reply.textContent = result.explanation || 'Done.';
      if (result.actions && result.actions.length && hooks.applyActions) {
        hooks.applyActions(result.actions);
      }
    }
    sendBtn.disabled = false;
    input.value = '';
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}
