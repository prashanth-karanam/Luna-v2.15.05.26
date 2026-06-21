/* ------------------------------------------------------------
   Luna ‑‑‑ AI Web OS – Core Script
   ------------------------------------------------------------ */

"use strict";

/* ─── GLOBAL STATE & CONFIG ────────────────────────────────── */
const cfg = {
  geminiKey: '',
  geminiKeys: '',
  geminiModel: 'gemini-1.5-pro',
  groqKey: '',
  groqKeys: '',
  groqModel: 'mixtral-8x7b-32768',
  engine: 'auto',
  systemPrompt: '',
  wakeWord: '',
  wallpaperBlur: 0,
  rememberHistory: true,
  // …
};

const state = {
  screen: 'chat',
  history: [],
  totalTokens: 0,
  usageLog: [],
  geminiIdx: -1,
  groqIdx: -1,
  waitingForPythonInput: false,
};

/* ─── UTILS ─────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const log = console.log;

/* ─── SYSTEM PROMPT BUILDER ─────────────────────────────────── */
function getSystemPrompt(userQuery) {
  const date = new Date().toLocaleDateString();
  const time = new Date().toLocaleTimeString();
  const currentMode = state ? state.screen.toUpperCase() : 'UNKNOWN';

  let base = `Luna OS | ${date} ${time} | ${currentMode}
Rules: Use \`\`\` for code. Tags: [OPEN_IDE], [CLOSE_IDE], [OPEN_STORAGE], [OPEN_WALLPAPER_PICKER], [SET_BG:file_path], [SET_BG_BLUR:PX], [MODE:CHAT/VOICE], [OPEN_BROWSER:url], [PLAY_TMDB:id].
Tags ONLY if asked. Voice: 1‑sentence replies.`;

  const needsWallpaper = /(wallpaper|background|theme|bg|image|pic)/.test(userQuery);
  if (needsWallpaper) {
    // … wallpaper logic here …
  }
  return base;
}

/* ─── COMMAND PARSER ──────────────────────────────────────── */
function parseAICommands(text) {
  let clean = text;

  // ─── UI CONTROLS ───────
  if (text.match(/\[OPEN_IDE\]/i)) {
    clean = clean.replace(/\[OPEN_IDE\]/gi, '');
    setTimeout(() => toggleIDE(true), 500);
  }
  if (text.match(/\[CLOSE_IDE\]/i)) {
    clean = clean.replace(/\[CLOSE_IDE\]/gi, '');
    setTimeout(() => $('idePane').classList.add('hidden'), 500);
  }
  if (text.match(/\[OPEN_STORAGE\]/i)) {
    clean = clean.replace(/\[OPEN_STORAGE\]/gi, '');
    setTimeout(() => { updateStorageUI(); $('storageModal').classList.remove('hidden'); }, 500);
  }
  if (text.match(/\[OPEN_WALLPAPER_PICKER\]/i)) {
    clean = clean.replace(/\[OPEN_WALLPAPER_PICKER\]/gi, '');
    setTimeout(() => openWallpaperPicker(), 400);
  }

  // ─── PLAY_TMDB ───────
  const tmdbMatch = text.match(/\[PLAY_TMDB:([^\]]+)\]/i);
  if (tmdbMatch) {
    clean = clean.replace(tmdbMatch[0], '');
    const tmdbId = tmdbMatch[1].trim();
    const suffix = (tmdbId.endsWith('-tv') || tmdbId.endsWith('-movie')) ? '' : '-tv';
    const net27Url = `https://net27.cc/#w=${tmdbId}${suffix}`;
    setTimeout(() => openBrowserModal(net27Url), 500);
  }

  // ─── BACKGROUND CHANGES ───────
  const bgMatch = text.match(/\[SET_BG:([^\]]+)\]/i);
  if (bgMatch) {
    clean = clean.replace(bgMatch[0], '');
    applyWallpaper(bgMatch[1].trim());
  }
  const blurMatch = text.match(/\[SET_BG_BLUR:([^\]]+)\]/i);
  if (blurMatch) {
    clean = clean.replace(blurMatch[0], '');
    const b = parseInt(blurMatch[1], 10);
    if (!isNaN(b)) {
      cfg.wallpaperBlur = b;
      localStorage.setItem('luna_wallpaperBlur', b);
      applyWallpaperBlur();
    }
  }

  // ─── MODE SWITCHES ───────
  if (/(?:\bMODE:CHAT\b)/i.test(text)) {
    clean = clean.replace(/\[MODE:CHAT\]/gi, '');
    setTimeout(() => showScreen('chat'), 500);
  }
  if (/(?:\bMODE:VOICE\b)/i.test(text)) {
    clean = clean.replace(/\[MODE:VOICE\]/gi, '');
    setTimeout(() => showScreen('voice'), 500);
  }

  // ─── FINAL CLEANUP ───────
  clean = clean.replace(/\[PASTE_CODE(?::([a-zA-Z]*))?\]/gi, '');
  clean = clean.replace(/\[OPEN_BROWSER:[^\]]+\]/gi, '');   // removed generic fallback
  clean = clean.replace(/\[PLAY_TMDB:[^\]]+\]/gi, '');
  clean = clean.replace(/\[SET_BG:[^\]]+\]/gi, '');
  clean = clean.replace(/\[SET_BG_BLUR:[^\]]+\]/gi, '');
  clean = clean.replace(/\[MODE:(?:CHAT|VOICE)\]/gi, '');
  clean = clean.replace(/\[OPEN_IDE\]/gi, '');
  clean = clean.replace(/\[CLOSE_IDE\]/gi, '');
  clean = clean.replace(/\[OPEN_STORAGE\]/gi, '');
  clean = clean.replace(/\[OPEN_WALLPAPER_PICKER\]/gi, '');

  return clean.trim();
}

/* ─── SEND MESSAGE ─────────────────────────────────────── */
async function sendMessage() {
  const text = $('msgInput').value.trim();
  if (!text) return;
  $('msgInput').value = '';
  $('msgInput').style.height = 'auto';
  addBubble('user', text);

  if (state.waitingForPythonInput) {
    state.waitingForPythonInput = false;
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PYTHON_INPUT_REPLY',
        answer: text,
      });
    }
    $('msgInput').placeholder = 'Ask Luna anything…';
    return;
  }

  $('typingIndicator').classList.remove('hidden');
  $('sendBtn').disabled = true;

  const reply = await callAI(text);
  $('typingIndicator').classList.add('hidden');
  $('sendBtn').disabled = false;

  const clean = parseAICommands(reply);
  if (clean) addBubbleReveal('luna', clean);
  if (attachedImageBase64) clearImageAttachment();
}

/* ─── AI CALLS (Gemini / Groq) ───────────────────────────── */
async function callAI(userText) {
  state.history.push({ role: 'user', text: userText });
  saveHistory();

  const engine = cfg.engine === 'auto'
    ? (cfg.geminiKey ? 'gemini' : 'groq')
    : cfg.engine;

  let sysPrompt = getSystemPrompt(userText.toLowerCase());
  if (cfg.systemPrompt.trim() !== '') {
    sysPrompt += `\n\n[ADDITIONAL USER INSTRUCTIONS]:\n${cfg.systemPrompt}`;
  }

  startBrainActivity();

  try {
    let reply = '';
    if (engine === 'gemini' && cfg.geminiKey) reply = await callGemini(userText, sysPrompt, state.geminiIdx);
    else if (cfg.groqKey) reply = await callGroq(userText, sysPrompt, state.groqIdx);
    else reply = '⚠️ APIs not configured.';

    stopBrainActivity();
    state.history.push({ role: 'model', text: reply });
    saveHistory();
    return reply;
  } catch (err) {
    stopBrainActivity();
    return `❗ Engine Error: ${err.message}`;
  }
}

/* ─── Gemini Call ─────────────────────────────────────── */
async function callGemini(userText, sysPrompt, keyIndex = -1) {
  const allBackupKeys = cfg.geminiKeys.split('\n').map(k => k.trim()).filter(k => k);
  let key = cfg.geminiKey;
  if (keyIndex >= 0 && keyIndex < allBackupKeys.length) key = allBackupKeys[keyIndex];

  const url = `${GEMINI_BASE}/${cfg.geminiModel}:generateContent?key=${key}`;

  // Build user parts (text + optional image)
  const userParts = [];
  if (attachedImageBase64 && attachedImageMime) {
    userParts.push({ inlineData: { mimeType: attachedImageMime, data: attachedImageBase64 } });
  }
  userParts.push({ text: userText });

  // Build history (token‑optimized)
  const cleanHistory = [];
  state.history.slice(-4, -1).forEach(m => {
    const role = m.role === 'user' ? 'user' : 'model';
    const txt = m.text.substring(0, 800);
    if (cleanHistory.length && cleanHistory[cleanHistory.length - 1].role === role) {
      cleanHistory[cleanHistory.length - 1].parts[0].text += `\n\n${txt}`;
    } else {
      cleanHistory.push({ role, parts: [{ text: txt }] });
    }
  });

  const contents = [
    { role: 'user', parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: 'Acknowledged.' }] },
    ...cleanHistory,
    { role: 'user', parts: userParts },
  ];

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  };

  // Enable Google Search grounding only when needed
  const needsSearch = /(search|look up|latest|news|weather|who is|what is the current)/i.test(userText);
  if (needsSearch && !attachedImageBase64) {
    body.tools = [{ googleSearch: {} }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (data.error) {
    const errStr = String(data.error.message || '').toLowerCase();
    if (data.error.code === 429 ||
        data.error.status === 'RESOURCE_EXHAUSTED' ||
        data.error.code === 404 ||
        data.error.status === 'NOT_FOUND' ||
        errStr.includes('quota') ||
        errStr.includes('exhausted')) {
      if (keyIndex + 1 < allBackupKeys.length) {
        state.geminiIdx = keyIndex + 1;
        localStorage.setItem('luna_geminiIdx', state.geminiIdx);
        console.log(`🔄 Gemini key exhausted. Rotating to backup key ${state.geminiIdx + 1}…`);
        return callGemini(userText, sysPrompt, state.geminiIdx);
      } else {
        showToast('⚠️ Gemini quota exhausted. No backup keys left.', true);
      }
    }
    throw new Error(data.error.message);
  }

  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '…';
  updateTokens(data.usageMetadata?.totalTokenCount || 0);
  return reply;
}

/* ─── Groq Call ─────────────────────────────────────────── */
async function callGroq(userText, sysPrompt, keyIndex = -1, dropHistory = false) {
  const allBackupKeys = cfg.groqKeys.split('\n').map(k => k.trim()).filter(k => k);
  let key = cfg.groqKey;
  if (keyIndex >= 0 && keyIndex < allBackupKeys.length) key = allBackupKeys[keyIndex];

  const cleanMessages = [{ role: 'system', content: sysPrompt }];
  if (!dropHistory) {
    state.history.slice(-4, -1).forEach(m => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      const txt = m.text.substring(0, 800);
      if (cleanMessages[cleanMessages.length - 1].role === role) {
        cleanMessages[cleanMessages.length - 1].content += `\n\n${txt}`;
      } else {
        cleanMessages.push({ role, content: txt });
      }
    });
  }
  cleanMessages.push({ role: 'user', content: userText });

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: cfg.groqModel,
      messages: cleanMessages,
      max_tokens: 8192,
      temperature: 0.7,
    }),
  });
  const data = await res.json();

  if (data.error) {
    const err = String(data.error.message || '').toLowerCase();
    if (!dropHistory && (err.includes('request too large') || err.includes('tokens per minute') || err.includes('tpm') || err.includes('rate_limit'))) {
      console.log('⚠️ Groq limit hit – retrying without history...');
      return callGroq(userText, sysPrompt, keyIndex, true);
    }
    if ((data.error.code === 429 || err.includes('rate_limit') || err.includes('quota')) && keyIndex + 1 < allBackupKeys.length) {
      state.groqIdx = keyIndex + 1;
      localStorage.setItem('luna_groqIdx', state.groqIdx);
      console.log(`🔄 Groq exhausted. Rotating to backup key ${state.groqIdx + 1}…`);
      return callGroq(userText, sysPrompt, state.groqIdx);
    }
    throw new Error(data.error.message);
  }

  const reply = data.choices?.[0]?.message?.content ?? '…';
  updateTokens(data.usage?.total_tokens || 0);
  return reply;
}

/* ─── UI HELPERS ────────────────────────────────────────── */
function addBubble(sender, text) {
  if (sender === 'system') {
    showToast(text);
    return;
  }
  const isLuna = sender === 'luna';
  const row = document.createElement('div');
  row.className = `bubble-row${isLuna ? '' : ' user-row'}`;
  row.innerHTML = `
    ${isLuna ? `<div class="avatar la" style="background:transparent;box-shadow:none;">
       <div class="mini-orb-wrap" style="transform:scale(0.65);">
         <div class="mini-ring"></div><div class="mini-orb-core"></div>
       </div>
     </div>` : ''}
    <div class="bubble-col${isLuna ? '' : ' uc'}">
      <span class="sender-name">${isLuna ? 'LUNA' : 'YOU'}</span>
      <div class="bubble ${isLuna ? 'lb' : 'ub'}">${formatText(text)}</div>
    </div>
    ${!isLuna ? `<div class="avatar ua">👤</div>` : ''}`;
  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function addBubbleReveal(sender, text) {
  const isLuna = sender === 'luna';
  const row = document.createElement('div');
  row.className = `bubble-row${isLuna ? '' : ' user-row'}`;
  row.innerHTML = `
    ${isLuna ? `<div class="avatar la" style="background:transparent;box-shadow:none;">
       <div class="mini-orb-wrap" style="transform:scale(0.65);">
         <div class="mini-ring"></div><div class="mini-orb-core"></div>
       </div>
     </div>` : ''}
    <div class="bubble-col${isLuna ? '' : ' uc'}">
      <span class="sender-name">${isLuna ? 'LUNA' : 'YOU'}</span>
      <div class="bubble ${isLuna ? 'lb' : 'ub'}">${formatText(text)}</div>
    </div>`;
  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

/* ─── MODAL LOGIC (Browser & Settings) ───────────────────── */
function openBrowserModal(url) {
  $('browserModal').classList.remove('hidden');
  if (url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    if ($('browserUrl')) $('browserUrl').value = url;
    if ($('browserFrame')) $('browserFrame').src = url;
  }
}
if ($('closeBrowser')) $('closeBrowser').addEventListener('click', () => {
  $('browserModal').classList.add('hidden');
  if ($('browserFrame')) $('browserFrame').src = 'about:blank';
});
if ($('browserGo')) {
  $('browserGo').addEventListener('click', () => {
    let val = $('browserUrl').value.trim();
    if (!val) return;
    if (!val.startsWith('http')) val = 'https://' + val;
    $('browserFrame').src = val;
  });
}

/* ─── SETTINGS SAVE / LOAD ────────────────────────────────── */
$('saveSettings').addEventListener('click', () => {
  cfg.geminiKey = $('geminiKey').value.trim();
  cfg.geminiKeys = $('geminiKeys') ? $('geminiKeys').value.trim() : '';
  cfg.geminiModel = $('geminiModel').value;
  cfg.groqKey = $('groqKey').value.trim();
  cfg.groqKeys = $('groqKeys') ? $('groqKeys').value.trim() : '';
  cfg.groqModel = $('groqModel').value;
  cfg.engine = $('activeEngine').value;
  cfg.systemPrompt = $('systemPrompt').value.trim();
  cfg.wakeWord = $('wakeWord').value.trim();
  cfg.wallpaperBlur = parseInt($('wpBlurRange').value, 10);

  Object.keys(cfg).forEach(k => localStorage.setItem(`luna_${k}`, cfg[k]));

  // Reset key indices
  state.geminiIdx = -1;
  state.groqIdx = -1;
  localStorage.setItem('luna_geminiIdx', -1);
  localStorage.setItem('luna_groqIdx', -1);

  applyWallpaperBlur();
  closeSettings();
  showToast('⚙️ Settings saved. API keys reset.');
});

/* ─── MOBILE MENU HANDLING ─────────────────────────────── */
if ($('mobileMenuBtn')) {
  $('mobileMenuBtn').addEventListener('click', () => {
    $('navButtonsWrap').classList.toggle('show');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#mobileMenuBtn') && !e.target.closest('#navButtonsWrap')) {
      $('navButtonsWrap').classList.remove('show');
    }
  });
}

/* ─── INITIALISATION ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Load any persisted settings, history, etc.
  // (omitted for brevity – already present in original file)
});

/* ------------------------------------------------------------
   END OF script.js
   ------------------------------------------------------------ */
