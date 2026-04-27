// KFG Interactive Video Prototype — state machine + UI choreography

const video         = document.getElementById('main-video');
const preloadVideo  = document.getElementById('preload-video');
const overlay       = document.getElementById('overlay');
const promptEl      = document.getElementById('prompt');
const optionsEl     = document.getElementById('options');
const ghostPrompt   = document.getElementById('ghost-prompt');
const placeholder   = document.getElementById('placeholder');
const phNode        = document.getElementById('ph-node');
const phFile        = document.getElementById('ph-file');
const phContinue    = document.getElementById('ph-continue');
const ccBtn         = document.getElementById('cc-toggle');
const playBtn       = document.getElementById('play-toggle');
const startScreen   = document.getElementById('start-screen');
const startBtn      = document.getElementById('start-btn');
const progress      = document.getElementById('progress');
const progressFill  = document.getElementById('progress-fill');
const progressCue   = document.getElementById('progress-cue');
const cueEl         = document.getElementById('cue');
const cueCountEl    = document.getElementById('cue-count');
const cueLabelEl    = document.getElementById('cue-label');
const backBtn       = document.getElementById('back-btn');
const ctaEl         = document.getElementById('cta');
const ctaLabelEl    = document.getElementById('cta-label');

const PRE_REVEAL_LEAD = 3.5;            // legacy — no longer used for in-frame ghost
const COUNTDOWN_LEAD = 5;               // seconds before end that the cue countdown ticks
const HUB_NODE_ID = 'hub';
const NO_BACK_NODES = new Set(['intro', 'hub']);
const PANEL_DELAY = 280;                // matches --d-base in CSS
const STAGGER = 60;                     // matches --stagger in CSS
const POST_PANEL_GUARD = 200;           // extra ms before buttons accept clicks

let config = null;
let currentNodeId = null;
let lastDecisionId = null;
let captionsOn = true;
let transitionTimer = null;
let preReveal = { armed: false, listener: null };
let progressListener = null;
let countdown = { listener: null, shown: false, current: null, tickTimer: null };

// ============================================================================
// Boot
// ============================================================================

async function init() {
  try {
    const res = await fetch('tree-config.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    console.error('Failed to load tree-config.json:', err);
    renderFatalError(
      'Could not load tree-config.json',
      'Serve via `python -m http.server 8000`. Opening index.html directly will not work.'
    );
    return;
  }

  bindControls();
  setupKeyboard();
  applyCta();
  bindBackButton();
  updateBackButton();

  startBtn.addEventListener('click', () => {
    startScreen.classList.add('hidden');
    goTo(config.start);
  });
}

function applyCta() {
  if (!config.cta || !ctaEl) return;
  if (config.cta.url) ctaEl.setAttribute('href', config.cta.url);
  if (config.cta.label && ctaLabelEl) ctaLabelEl.textContent = config.cta.label;
}

function bindBackButton() {
  backBtn.addEventListener('click', () => {
    if (backBtn.disabled) return;
    goTo(HUB_NODE_ID);
  });
}

function updateBackButton() {
  backBtn.disabled = !currentNodeId || NO_BACK_NODES.has(currentNodeId);
}

function renderFatalError(title, hint) {
  clearChildren(document.body);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:48px;color:#2A2622;font-family:Manrope,system-ui,sans-serif;max-width:560px;margin:80px auto';
  const h = document.createElement('h2');
  h.style.cssText = 'font-family:Fraunces,serif;font-style:italic;font-weight:400;font-size:32px;margin-bottom:12px';
  h.textContent = title;
  const p = document.createElement('p');
  p.style.cssText = 'color:#6B6359;line-height:1.55';
  p.textContent = hint;
  wrap.appendChild(h);
  wrap.appendChild(p);
  document.body.appendChild(wrap);
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ============================================================================
// State machine
// ============================================================================

function goTo(nodeId) {
  const node = config.nodes[nodeId];
  if (!node) {
    console.error(`Unknown node: ${nodeId}`);
    return;
  }

  if (transitionTimer) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }

  detachPreReveal();
  detachProgress();
  detachCountdown();
  hideGhostPrompt();
  hideCue();
  hideOverlay();
  hidePlaceholder();
  resetProgressBar();

  currentNodeId = nodeId;
  updateBackButton();

  if (node.type === 'video') {
    playVideoNode(nodeId, node);
  } else if (node.type === 'decision') {
    lastDecisionId = nodeId;
    showDecision(node);
  } else {
    console.error(`Unknown node type at ${nodeId}: ${node.type}`);
  }
}

function playVideoNode(nodeId, node) {
  const videoPath = `videos/${node.video}`;
  const vttFile = node.video.replace(/\.[^.]+$/, '.vtt');
  const vttPath = `transcripts/${vttFile}`;

  clearChildren(video);

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'English';
  track.srclang = 'en';
  track.addEventListener('error', () => {
    console.warn(`Subtitle track failed to load: ${vttPath}`);
  });
  track.src = vttPath;
  if (captionsOn) track.default = true;
  video.appendChild(track);

  let errored = false;
  const handleError = () => {
    if (errored) return;
    errored = true;
    console.warn(`Video failed to load: ${videoPath}`);
    showPlaceholder(nodeId, node.video, () => {
      if (node.next) goTo(node.next);
    });
  };
  video.onerror = handleError;

  const onLoaded = () => {
    applyTrackMode();
    armCountdown(node);
    attachProgress(node);
    video.removeEventListener('loadedmetadata', onLoaded);
  };
  video.addEventListener('loadedmetadata', onLoaded);

  video.onended = () => handleVideoEnd(node);

  video.src = videoPath;
  video.classList.remove('fade-out');

  // Safari rejects play() if called before the element is ready (readyState < 2).
  // Guard against that race so the first frame doesn't stay blank.
  const tryPlay = () => {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn('play() rejected:', err.message));
    }
  };
  if (video.readyState >= 2) {
    tryPlay();
  } else {
    video.addEventListener('canplay', tryPlay, { once: true });
  }

  preloadNext(node);
}

function handleVideoEnd(node) {
  detachPreReveal();
  detachProgress();
  detachCountdown();
  hideGhostPrompt();
  hideCue();
  hideProgressBar();

  if (!node.next) return;
  const nextNode = config.nodes[node.next];
  if (!nextNode) return;

  if (nextNode.type === 'video') {
    crossfadeTo(node.next);
  } else {
    video.pause();
    goTo(node.next);
  }
}

function crossfadeTo(nextNodeId) {
  video.classList.add('fade-out');
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    goTo(nextNodeId);
  }, 300);
}

function preloadNext(node) {
  const nextId = node.next;
  if (!nextId) return;
  const nextNode = config.nodes[nextId];
  if (!nextNode) return;

  let preloadId = null;
  if (nextNode.type === 'video') {
    preloadId = nextId;
  } else if (nextNode.type === 'decision' &&
             Array.isArray(nextNode.options) &&
             nextNode.options.length === 1) {
    preloadId = nextNode.options[0].next;
  }

  if (preloadId && config.nodes[preloadId] && config.nodes[preloadId].type === 'video') {
    const target = `videos/${config.nodes[preloadId].video}`;
    if (preloadVideo.getAttribute('src') !== target) {
      preloadVideo.src = target;
    }
  }
}

// ============================================================================
// Ghost prompt — pre-reveal upcoming question text in the last few seconds
// ============================================================================

function armPreReveal(node) {
  detachPreReveal();
  if (!node.next) return;
  const nextNode = config.nodes[node.next];
  if (!nextNode || nextNode.type !== 'decision') return;
  const text = nextNode.prompt;
  if (!text) return;

  preReveal.armed = false;
  preReveal.listener = () => {
    if (preReveal.armed) return;
    if (!Number.isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= PRE_REVEAL_LEAD) {
      preReveal.armed = true;
      showGhostPrompt(text);
    }
  };
  video.addEventListener('timeupdate', preReveal.listener);
}

function detachPreReveal() {
  if (preReveal.listener) {
    video.removeEventListener('timeupdate', preReveal.listener);
  }
  preReveal.listener = null;
  preReveal.armed = false;
}

function showGhostPrompt(text) {
  ghostPrompt.textContent = text;
  // Force a frame so the transition runs.
  requestAnimationFrame(() => ghostPrompt.classList.add('visible'));
}

function hideGhostPrompt() {
  ghostPrompt.classList.remove('visible');
}

// ============================================================================
// Outside-the-frame cue: "Ask Emma a question" with countdown
// ============================================================================

function armCountdown(node) {
  detachCountdown();
  if (!node.next) return;
  const nextNode = config.nodes[node.next];
  if (!nextNode || nextNode.type !== 'decision') return;

  cueLabelEl.textContent = nextNode.prompt || 'Ask Emma a question';
  // Show the cue immediately when playback starts; the countdown pip
  // only appears in the final COUNTDOWN_LEAD seconds.
  showCue();
  cueEl.dataset.counting = 'false';
  cueCountEl.textContent = '';

  countdown.current = null;

  countdown.listener = () => {
    if (!Number.isFinite(video.duration)) return;
    const remaining = video.duration - video.currentTime;
    if (remaining < 0) return;
    if (remaining > COUNTDOWN_LEAD) {
      if (cueEl.dataset.counting === 'true') {
        cueEl.dataset.counting = 'false';
        cueCountEl.textContent = '';
        countdown.current = null;
      }
      return;
    }

    if (cueEl.dataset.counting !== 'true') {
      cueEl.dataset.counting = 'true';
    }

    const display = Math.max(1, Math.ceil(remaining));
    if (display !== countdown.current) {
      countdown.current = display;
      cueCountEl.textContent = String(display);
      cueEl.dataset.tick = 'true';
      if (countdown.tickTimer) clearTimeout(countdown.tickTimer);
      countdown.tickTimer = setTimeout(() => {
        cueEl.dataset.tick = 'false';
      }, 180);
    }
  };
  video.addEventListener('timeupdate', countdown.listener);
}

function detachCountdown() {
  if (countdown.listener) {
    video.removeEventListener('timeupdate', countdown.listener);
    countdown.listener = null;
  }
  if (countdown.tickTimer) {
    clearTimeout(countdown.tickTimer);
    countdown.tickTimer = null;
  }
  countdown.shown = false;
  countdown.current = null;
}

function showCue() {
  cueEl.dataset.visible = 'true';
  cueEl.setAttribute('aria-hidden', 'false');
}

function hideCue() {
  cueEl.dataset.visible = 'false';
  cueEl.dataset.tick = 'false';
  cueEl.dataset.counting = 'false';
  cueEl.setAttribute('aria-hidden', 'true');
}

// ============================================================================
// Progress bar — fills as the clip plays; cue dot signals an upcoming decision
// ============================================================================

function attachProgress(node) {
  detachProgress();

  const nextNode = node.next ? config.nodes[node.next] : null;
  const nextIsDecision = nextNode && nextNode.type === 'decision';

  progress.dataset.visible = 'true';
  progress.dataset.decisionAhead = nextIsDecision ? 'true' : 'false';
  progressCue.dataset.visible = nextIsDecision ? 'true' : 'false';
  progressCue.dataset.imminent = 'false';

  progressListener = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const pct = Math.min(100, (video.currentTime / video.duration) * 100);
    progressFill.style.width = pct + '%';

    if (nextIsDecision) {
      const remaining = video.duration - video.currentTime;
      const imminent = remaining <= PRE_REVEAL_LEAD;
      if ((progressCue.dataset.imminent === 'true') !== imminent) {
        progressCue.dataset.imminent = imminent ? 'true' : 'false';
      }
    }
  };
  video.addEventListener('timeupdate', progressListener);
}

function detachProgress() {
  if (progressListener) {
    video.removeEventListener('timeupdate', progressListener);
    progressListener = null;
  }
}

function resetProgressBar() {
  progressFill.style.width = '0%';
  progressCue.dataset.imminent = 'false';
}

function hideProgressBar() {
  progress.dataset.visible = 'false';
  progressCue.dataset.visible = 'false';
  progressCue.dataset.imminent = 'false';
}

// ============================================================================
// Decision UI — entrance, stagger, click-guard, onboarding
// ============================================================================

function showDecision(node) {
  promptEl.textContent = node.prompt || '';
  clearChildren(optionsEl);

  const options = node.options || [];
  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.type = 'button';
    btn.style.setProperty('--i', String(i));
    btn.setAttribute('aria-disabled', 'true');

    const label = document.createElement('span');
    label.className = 'option-label';
    label.textContent = opt.label;
    btn.appendChild(label);

    btn.addEventListener('click', e => {
      if (btn.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        return;
      }
      handleDecisionPick(opt.next);
    });
    optionsEl.appendChild(btn);
  });

  overlay.classList.remove('hidden');
  // Trigger the .visible state on the next frame so transitions run.
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Activate buttons after the panel + last button stagger has settled.
  const enableDelay = PANEL_DELAY + (options.length - 1) * STAGGER + POST_PANEL_GUARD;
  setTimeout(() => {
    const btns = optionsEl.querySelectorAll('button.option');
    btns.forEach(b => b.removeAttribute('aria-disabled'));
    if (btns[0]) btns[0].focus({ preventScroll: true });
  }, enableDelay);
}

function handleDecisionPick(nextId) {
  goTo(nextId);
}

function hideOverlay() {
  overlay.classList.remove('visible');
  overlay.classList.add('hidden');
}


// ============================================================================
// Missing-video placeholder
// ============================================================================

function showPlaceholder(nodeId, filename, onContinue) {
  phNode.textContent = nodeId;
  phFile.textContent = `videos/${filename}`;
  phContinue.onclick = () => {
    hidePlaceholder();
    onContinue();
  };
  placeholder.classList.remove('hidden');
}

function hidePlaceholder() {
  placeholder.classList.add('hidden');
}

// ============================================================================
// Controls — CC + play/pause
// ============================================================================

function bindControls() {
  ccBtn.addEventListener('click', () => {
    captionsOn = !captionsOn;
    ccBtn.setAttribute('aria-pressed', String(captionsOn));
    applyTrackMode();
  });

  playBtn.addEventListener('click', () => {
    if (video.paused) video.play(); else video.pause();
  });

  video.addEventListener('play', () => {
    playBtn.dataset.paused = 'false';
    playBtn.setAttribute('aria-label', 'Pause');
  });
  video.addEventListener('pause', () => {
    playBtn.dataset.paused = 'true';
    playBtn.setAttribute('aria-label', 'Play');
  });
}

function applyTrackMode() {
  if (!video.textTracks || video.textTracks.length === 0) return;
  for (const t of video.textTracks) {
    t.mode = captionsOn ? 'showing' : 'hidden';
  }
}

// ============================================================================
// Keyboard
// ============================================================================

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && lastDecisionId) {
      e.preventDefault();
      goTo(lastDecisionId);
      return;
    }
    // Don't let Space toggle play during a decision panel.
    if (e.key === ' ' && overlay.classList.contains('visible')) {
      e.preventDefault();
    }
  });
}

init();
