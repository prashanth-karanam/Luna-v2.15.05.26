/* ══════════════════════════════════════════════════════
   LUNA AI – Core Logic (v3 - Holographic Orb & Dual Engine)
   ══════════════════════════════════════════════════════ */

// ─── Config & Keys ────────────────────────────────────────
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_BASE    = 'https://api.groq.com/openai/v1';

// Storage & editor - declared early to avoid ReferenceError in getSystemPrompt
let storageData = JSON.parse(localStorage.getItem('luna_storage') || '[]');
let monacoEditor = null;

// Dynamic System Prompt including Time and Date
const getSystemPrompt = (userQuery = '') => {
  const now = new Date();
  const time = now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const date = now.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});
  const currentMode = state ? state.screen.toUpperCase() : 'UNKNOWN';
  
  const builtinPaths = BUILTIN_WALLPAPERS.map(w => w.file);
  const storageImages = storageData.filter(f => f.content && f.content.startsWith('data:image')).map(f => f.name);
  
  let base = `Luna OS | ${date} ${time} | ${currentMode}
Rules: Use \`\`\` for code. No '$'. Tags: [OPEN_IDE], [CLOSE_IDE], [OPEN_STORAGE], [OPEN_WALLPAPER_PICKER], [SET_BG:file_path], [SET_BG_BLUR:PX], [MODE:CHAT/VOICE]. 
Tags ONLY if asked. Voice: 1-sentence replies.

[WALLPAPER ACCESS]: You have control over the user's background wallpaper.
- To open the wallpaper selection window for the user, output: [OPEN_WALLPAPER_PICKER]
- To directly change the background to an image, output: [SET_BG:file_path] (e.g. [SET_BG:naruto/naruto3.png] or [SET_BG:random]).
- Do NOT read the full image data. Just select from the following available names/file_paths:
  * Built-in Series: ${builtinPaths.join(', ')}
  * Custom Storage: ${storageImages.length > 0 ? storageImages.join(', ') : 'None'}`;

  if (typeof lunaMemory !== 'undefined' && lunaMemory.length > 0) {
    base += `\n\n[LUNA LONG-TERM MEMORY]:\n`;
    lunaMemory.forEach((m, i) => { base += `${i+1}. ${m}\n`; });
  }

  // INTELLIGENT CONTEXT GATHERING: Only read massive files if the user is asking about them.
  // CONTEXT: Only read if user explicitly asks for files/code
  const needsFiles = /(read|file|storage|bank|context|document)/.test(userQuery);
  if (typeof storageData !== 'undefined' && storageData.length > 0) {
    if (needsFiles) {
      base += `\n\n[DATA BANK CONTEXT]: You have access to the following user files in storage:\n`;
      storageData.forEach(f => { 
        if (!f.content.startsWith('data:image')) {
          base += `\n--- FILE: ${f.name} ---\n${f.content.substring(0, 500)}... [CONTENT TRUNCATED FOR MEMORY SAVING]\n`; 
        } else {
          base += `\n--- IMAGE FILE: ${f.name} (Visual Data Not Provided in Text) ---\n`;
        }
      });
    } else {
      base += `\n\n[DATA BANK CONTEXT]: You have files uploaded: ${storageData.map(f=>f.name).join(', ')}. (Contents hidden to save tokens. The user did not ask about files).`;
    }
  }

  // INTELLIGENT IDE GATHERING: Only read the console if the user asks about code.
  const needsIDE = /(debug|fix|console|ide|error|script|this code)/.test(userQuery);
  if (monacoEditor) {
    const currentCode = monacoEditor.getValue();
    if (currentCode.trim().length > 0) {
      if (needsIDE) {
        base += `\n\n[CURRENT IDE CONTENT]: The user currently has this code open in the IDE console:\n\`\`\`\n${currentCode.substring(0, 1500)}\n\`\`\``;
      } else {
        base += `\n\n[CURRENT IDE CONTENT]: The IDE is currently active but hidden to save tokens. (The user did not ask about code).`;
      }
    }
  }

  return base;
};

// ─── State ────────────────────────────────────────────────
const cfg = {
  geminiKey:    localStorage.getItem('luna_geminiKey')    || '',
  geminiKeys:   localStorage.getItem('luna_geminiKeys')   || '',
  geminiModel:  (function(){ let m = localStorage.getItem('luna_geminiModel') || 'gemini-2.5-flash'; if(m.includes('1.5')) return 'gemini-2.5-flash'; if(m==='gemini-3.1-pro') return 'gemini-3.1-pro-preview'; if(m==='gemini-3-flash') return 'gemini-3-flash-preview'; return m; })(),
  groqKey:      localStorage.getItem('luna_groqKey')      || '',
  groqKeys:     localStorage.getItem('luna_groqKeys')     || '',
  groqModel:    (localStorage.getItem('luna_groqModel') || 'llama-3.1-8b-instant').replace('llama3-8b-8192', 'llama-3.1-8b-instant'),
  engine:       localStorage.getItem('luna_engine')       || 'auto',
  systemPrompt: localStorage.getItem('luna_system')       || '',
  wakeWord:     localStorage.getItem('luna_wakeWord')     || 'wake up luna',
  rememberHistory: localStorage.getItem('luna_rememberHistory') !== 'false',
  wallpaperBlur: parseInt(localStorage.getItem('luna_wallpaperBlur') || '0', 10)
};

const state = {
  screen:       'sleep',
  awake:        false,
  listening:    false,
  speaking:     false,
  totalTokens:  parseInt(localStorage.getItem('luna_totalTokens') || '0', 10),
  history:      [],
  usageLog:     JSON.parse(localStorage.getItem('luna_usageLog') || '[]'),
  startMode:    'chat',
  geminiIdx:    parseInt(localStorage.getItem('luna_geminiIdx') || '-1', 10),
  groqIdx:      parseInt(localStorage.getItem('luna_groqIdx') || '-1', 10),
  currentLayer: 1
};

function updateAnalyticsUI() {
  const now = Date.now(), day = 86400000;
  const t24 = state.usageLog.filter(l => l.ts > now - day).reduce((a, b) => a + b.count, 0);
  const t7d = state.usageLog.filter(l => l.ts > now - 7*day).reduce((a, b) => a + b.count, 0);
  const tAll = state.usageLog.reduce((a, b) => a + b.count, 0);
  if($('tokens24h')) $('tokens24h').textContent = t24;
  if($('tokens7d')) $('tokens7d').textContent = t7d;
  if($('tokensAll')) $('tokensAll').textContent = tAll;
}

let allSessions = JSON.parse(localStorage.getItem('luna_sessions') || '[]');
let currentSessionId = Date.now();

function saveHistory() {
  if (cfg.rememberHistory) {
    if(state.history.length > 40) state.history = state.history.slice(-40);
    let session = allSessions.find(s => s.id === currentSessionId);
    if (!session) {
       session = { id: currentSessionId, title: 'Chat ' + new Date().toLocaleTimeString(), history: [] };
       allSessions.unshift(session);
    }
    // Deep copy and strip base64 inlineData (images) to prevent QuotaExceededError crashes
    const safeHistory = state.history.map(msg => ({
      ...msg,
      parts: msg.parts ? msg.parts.map(p => {
        if (p.inlineData) return { text: '[Image Attached - Data Purged to Save Space]' };
        if (p.text) return { text: p.text };
        return p;
      }) : []
    }));
    session.history = safeHistory;
    if (allSessions.length > 10) allSessions = allSessions.slice(0, 10);
    try {
      localStorage.setItem('luna_sessions', JSON.stringify(allSessions));
    } catch (e) {
      console.warn("Storage full! Wiping old sessions to make room.");
      allSessions = [session];
      localStorage.setItem('luna_sessions', JSON.stringify(allSessions));
    }
  } else {
    localStorage.removeItem('luna_sessions');
  }
}

function loadHistoryUI() {
  const list = $('historyList');
  if(!list) return;
  list.innerHTML = '';
  if (allSessions.length === 0) {
    list.innerHTML = '<div style="color:var(--dim);font-size:0.8rem;text-align:center;padding:20px;">No past conversations yet.</div>';
    return;
  }
  allSessions.forEach(sess => {
     const row = document.createElement('div');
     row.style.cssText = 'display:flex;align-items:center;border-bottom:1px solid var(--border);transition:background 0.2s;';
     row.onmouseover = () => row.style.background = 'rgba(0,180,255,0.08)';
     row.onmouseout = () => row.style.background = 'transparent';

     const label = document.createElement('div');
     label.style.cssText = 'flex:1;padding:14px;cursor:pointer;color:var(--text);';
     label.textContent = sess.title + ` (${sess.history.length} msgs)`;
     label.onclick = () => {
         currentSessionId = sess.id;
         state.history = [...sess.history];
         $('messages').innerHTML = '';
         state.history.forEach(m => {
             if(m.role !== 'system') addBubble(m.role === 'user' ? 'user' : 'luna', m.text);
         });
         $('historyModal').classList.add('hidden');
     };

     const delBtn = document.createElement('button');
     delBtn.innerHTML = '✕';
     delBtn.title = 'Delete Conversation';
     delBtn.style.cssText = 'background:none;border:none;color:var(--dim);font-size:1.1rem;padding:14px;cursor:pointer;transition:color 0.2s;';
     delBtn.onmouseover = () => delBtn.style.color = 'var(--red)';
     delBtn.onmouseout = () => delBtn.style.color = 'var(--dim)';
     delBtn.onclick = (e) => {
         e.stopPropagation();
         allSessions = allSessions.filter(s => s.id !== sess.id);
         localStorage.setItem('luna_sessions', JSON.stringify(allSessions));
         if (currentSessionId === sess.id) {
             currentSessionId = Date.now();
             state.history = [];
             $('messages').innerHTML = '';
         }
         loadHistoryUI();
     };

     row.appendChild(label);
     row.appendChild(delBtn);
     list.appendChild(row);
  });
}

// ─── DOM Helpers ──────────────────────────────────────────
const $  = id => document.getElementById(id);
const q  = sel => document.querySelector(sel);
const qa = sel => document.querySelectorAll(sel);

// ─── Toast Notifications ──────────────────────────────────
function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:30px; left:50%; transform:translateX(-50%) translateY(20px);
    background:${isError ? 'rgba(255,60,60,0.92)' : 'rgba(0,180,255,0.92)'};
    color:#fff; padding:10px 22px; border-radius:30px; font-size:0.85rem;
    font-family:'Inter',sans-serif; letter-spacing:0.5px; z-index:99999;
    box-shadow:0 4px 24px rgba(0,0,0,0.4); opacity:0;
    transition:opacity 0.3s, transform 0.3s; pointer-events:none;
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => t.remove(), 350);
  }, 3000);
}

// ─── Holographic Orb Animation (Canvas) ───────────────────
function initOrb(canvasId) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = Math.min(cx, cy) * 0.9;
  
  let time = 0;
  
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    time += 0.02;
    
    // Core glow
    const pulse = Math.sin(time * 2) * 0.1 + 0.9;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5 * pulse);
    grd.addColorStop(0, 'rgba(0, 255, 255, 1.0)');
    grd.addColorStop(0.5, 'rgba(0, 150, 255, 0.6)');
    grd.addColorStop(1, 'rgba(0, 0, 50, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6 * pulse, 0, Math.PI * 2);
    ctx.fill();
    
    // Rotating Rings & Arcs
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    // Inner dashed ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.5);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.setLineDash([5, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    
    // Middle solid arcs
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-time * 0.8);
    ctx.strokeStyle = 'rgba(0, 255, 255, 1.0)';
    ctx.setLineDash([]);
    ctx.lineWidth = 5;
    for(let i=0; i<4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.8, i * Math.PI/2, i * Math.PI/2 + Math.PI/4);
        ctx.stroke();
    }
    ctx.restore();
    
    // Outer thin ring
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.3);
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    
    // Outer tick marks
    ctx.lineWidth = 4;
    for(let i=0; i<12; i++) {
        ctx.beginPath();
        ctx.moveTo(r * 0.9, 0);
        ctx.lineTo(r * 0.95, 0);
        ctx.stroke();
        ctx.rotate(Math.PI / 6);
    }
    ctx.restore();
    
    requestAnimationFrame(draw);
  }
  draw();
}

// Initialize all orbs
initOrb('sleepOrbCanvas');
initOrb('voiceOrbCanvas');
initOrb('chatOrbCanvas');

// ─── Data Bank (Storage) Logic ─────────────────────────────
// storageData already declared at top of file

window.removeStorage = function(index) {
  storageData.splice(index, 1);
  localStorage.setItem('luna_storage', JSON.stringify(storageData));
  updateStorageUI();
};

function updateStorageUI() {
  const list = $('storageList');
  if(!list) return;
  list.innerHTML = '';
  storageData.forEach((f, i) => {
    const div = document.createElement('div');
    div.style.padding = '5px 0';
    div.innerHTML = `📄 ${f.name} <span style="color:var(--dim); font-size:0.7rem;">(${(f.content.length/1024).toFixed(1)}kb)</span> <span style="color:var(--red);cursor:pointer;float:right;" onclick="removeStorage(${i})">✕</span>`;
    list.appendChild(div);
  });
}

function handleFileUpload(files) {
  for(let file of files) {
    const reader = new FileReader();
    reader.onload = e => {
      storageData.push({ name: file.name, content: e.target.result });
      localStorage.setItem('luna_storage', JSON.stringify(storageData));
      updateStorageUI();
    };
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }
}

// ─── Screen Transitions ──────────────────────────────────
function showScreen(name) {
  state.screen = name;
  $('sleepScreen').classList.toggle('hidden', name !== 'sleep');
  $('voiceScreen').classList.toggle('hidden', name !== 'voice');
  $('chatScreen').classList.toggle('hidden',  name !== 'chat');
  
  if (name !== 'sleep') $('sleepScreen').classList.add('fade-out');
  
  renderHoloClock(name);
  
  if (name === 'voice') { 
      $('modeRead').textContent = 'VOICE';
      // Only greet if the voice display is empty (first time or reset)
      const display = $('voiceReply');
      if (!display || !display.textContent.trim()) {
          setTimeout(speakGreeting, 400); 
      }
      startListening(); 
  }
  if (name === 'chat') { 
      $('modeRead').textContent = 'CHAT';
      setTimeout(() => addWelcomeIfEmpty(), 300); 
      $('msgInput').focus(); 
      if (typeof stopSpeaking === 'function') stopSpeaking();
      stopListening();
  }
}

// ─── Sleep Screen ────────────────────────────────────────
$('sleepVoiceBtn').addEventListener('click', e => {
  e.stopPropagation(); state.startMode = 'voice';
  $('sleepVoiceBtn').classList.add('active'); $('sleepChatBtn').classList.remove('active');
});
$('sleepChatBtn').addEventListener('click', e => {
  e.stopPropagation(); state.startMode = 'chat';
  $('sleepChatBtn').classList.add('active'); $('sleepVoiceBtn').classList.remove('active');
});

function wake() {
  if (state.awake) return;
  state.awake = true;
  $('statusRead').textContent = 'ACTIVE';
  showScreen(state.startMode);
}

$('sleepScreen').addEventListener('click', wake);

// ─── TTS & Audio ──────────────────────────────────────────
// Old speak function removed - using the new typewriter speak() instead.

function speakGreeting() {
  const h = new Date().getHours();
  const msg = h < 12 ? 'Good morning! I am Luna.' : h < 18 ? 'Good afternoon! I am Luna.' : 'Good evening! I am Luna.';
  $('voiceGreeting').textContent = msg;
  if (typeof speak === 'function') speak(msg);
}

// ─── Speech Recognition ──────────────────────────────────
let recognition;
function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = 'en-US';

  r.onstart = () => {
    state.listening = true;
    $('micBtn').classList.add('listening');
    $('micLabel').textContent = 'Listening…';
    $('waveform').classList.add('active');
  };
  r.onend = () => {
    state.listening = false;
    $('micBtn').classList.remove('listening');
    $('micLabel').textContent = 'Tap to speak';
    $('waveform').classList.remove('active');
    // LUNA SAFETY: Don't restart mic if she's currently speaking
    if (state.speaking) return;
    
    // Always restart if in voice or sleep mode so she can hear commands/wake-word
    if (state.screen === 'voice' || state.screen === 'sleep') {
      setTimeout(() => { 
        if (!state.listening && !state.speaking && (state.screen === 'voice' || state.screen === 'sleep')) { 
          try { r.start(); } catch(e) {} 
        } 
      }, 1000); // 1-second 'Deaf Period' for room silence
    }
  };
  r.onerror = () => { state.listening = false; };

  r.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    
    if (interim && state.screen === 'voice') {
      $('voiceTranscript').textContent = interim;
    }
    
    if (final.trim()) {
      const text = final.trim().toLowerCase();
      // LUNA SAFETY: Ignore junk/noise that is too short
      if (text.length < 3) return;
      
      if (state.screen === 'voice') $('voiceTranscript').textContent = final.trim();

      // Wake word check
      if (!state.awake && (text.includes(cfg.wakeWord) || text.includes('wake up luna'))) {
        wake(); return;
      }
      if (!state.awake) return;

      // Interrupt: if Luna is speaking, stop her and process the new input
      if (state.speaking) {
        stopSpeaking();
        setTimeout(() => {
          if (state.screen === 'voice') processVoiceChat(final.trim());
        }, 300);
        return;
      }

      // Mode switches — flexible phrase match, specific enough to not false-trigger
      const exactCmd = final.trim().toLowerCase();
      const isVoiceSwitch = ['voice mode','switch to voice','go to voice','switch to voice mode','go to voice mode','change to voice','switch mode to voice','enable voice mode'].some(p => exactCmd.includes(p));
      const isChatSwitch  = ['chat mode','text mode','switch to chat','go to chat','switch to chat mode','go to chat mode','switch to text mode','change to chat','enable chat mode'].some(p => exactCmd.includes(p));
      const isSleep       = ['sleep','go to sleep','goodnight','luna sleep','deactivate'].some(p => exactCmd.includes(p));
      const isStop        = ['stop','shut up','be quiet','stop talking','pause','silence'].some(p => exactCmd.includes(p));

      if (isChatSwitch)  { showScreen('chat');  return; }
      if (isVoiceSwitch) { showScreen('voice'); return; }
      if (isSleep)       { sleepLuna();         return; }
      if (isStop)        { stopSpeaking();      return; }

      // Process input
      if (state.screen === 'voice') processVoiceChat(final.trim());
      else if (state.screen === 'chat') {
          $('msgInput').value = final.trim();
          sendMessage();
      }
    }
  };
  return r;
}

function startListening() {
  if (!recognition) recognition = setupRecognition();
  if (!recognition) return;
  try { recognition.start(); } catch(e) {}
}
function stopListening() { if (recognition) try { recognition.stop(); } catch(e) {} }

$('micBtn').addEventListener('click', () => state.listening ? stopListening() : startListening());

function sleepLuna() {
  state.awake = false; state.screen = 'sleep';
  window.speechSynthesis.cancel();
  $('sleepScreen').classList.remove('fade-out', 'hidden');
  $('voiceScreen').classList.add('hidden');
  $('chatScreen').classList.add('hidden');
  // We keep the IDE open if it was open, or hide it if you prefer
  // if ($('idePane')) $('idePane').classList.add('hidden');
  $('statusRead').textContent = 'STANDBY';
  $('modeRead').textContent = 'SLEEP';
  // Note: we do NOT call stopListening() here because we need to hear the wake word!
}

// ─── AI Processing ────────────────────────────────────────
let typewriterTimer = null;

function stopSpeaking() {
  window.speechSynthesis.cancel();
  state.speaking = false;
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
}

function speak(text, onEnd, displayText) {
  const finalDisplayText = displayText || text;
  if (!text || !text.trim()) { if(onEnd) onEnd(); return; }
  
  window.speechSynthesis.cancel();
  state.speaking = false;
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }

  setTimeout(() => {
    let phoneticText = text
      .replace(/\bsure\b/gi, 'shoor')
      .replace(/\bLuna\b/gi, 'Loona')
      .replace(/\bAI\b/g, 'A.I.')
      .replace(/\bIDE\b/g, 'I.D.E.');

    const display = $('voiceReply');
    if (display) {
      display.innerHTML = '';
      display.classList.add('active');
    }

    state.speaking = true;
    const ut = new SpeechSynthesisUtterance(phoneticText);
    window._lunaActiveUtterance = ut;

    ut.onstart = () => {
      if (display) {
        // Instant render for reliability
        display.innerHTML = formatText(finalDisplayText);
      }
    };

    ut.onend = () => {
      state.speaking = false;
      if (display) display.classList.remove('active');
      if(onEnd) onEnd();
    };
    ut.onerror = (e) => { 
      // Ignore 'interrupted' errors caused by cancel()
      if (e.error === 'interrupted') return;
      state.speaking = false; 
      if (display) display.classList.remove('active');
      if(onEnd) onEnd(); 
    };
    
    window.speechSynthesis.speak(ut);
  }, 50); // 50ms delay to ensure clear buffer
}

async function processVoiceChat(text) {
  if (state.waitingForPythonInput) {
    state.waitingForPythonInput = false;
    $('voiceGreeting').textContent = 'Input sent...';
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PYTHON_INPUT_REPLY', answer: text });
      if ($('msgInput')) $('msgInput').placeholder = 'Ask Luna anything…';
    }
    setTimeout(() => {
      if (state.screen === 'voice') { $('voiceGreeting').textContent = 'Say something…'; startListening(); }
    }, 1000);
    return;
  }

  $('voiceGreeting').textContent = 'Processing…';
  const display = $('voiceReply');
  if (display) { display.textContent = ''; display.classList.remove('active'); }
  stopListening();
  const reply = await callAI(text);
  const clean = parseAICommands(reply);
  $('voiceGreeting').textContent = '';
  $('voiceTranscript').textContent = ''; // clear user transcript
  
  // For the screen: show everything (including code blocks)
  const displayText = clean.trim();
  
  // For the voice: strip code blocks so she doesn't read raw code out loud
  const spokenText = clean.replace(/```[\s\S]*?```/g, '').trim();
  
  // The 'speak' function now handles both: it reads spokenText and types displayText
  speak(spokenText, () => {
    if (state.screen === 'voice') { $('voiceGreeting').textContent = 'Say something…'; startListening(); }
  }, displayText);
}

function parseAICommands(text) {
  let clean = text;
  
  // Block mode switches if Luna is writing code (PASTE_CODE tag OR raw markdown code block)
  const isPasting = /\[PASTE_CODE/i.test(text);
  const hasCodeBlock = /```[\s\S]*?```/.test(text);
  const hasCode = isPasting || hasCodeBlock;

  // [MODE:CHAT] — only switch if user explicitly asked AND there's no code in the reply
  if (/(?<!["'])\[MODE:CHAT\]/i.test(text)) {
    clean = clean.replace(/\[MODE:CHAT\]/gi, '');
    if (!hasCode) {
      setTimeout(() => showScreen('chat'), 500);
    }
  }
  // [MODE:VOICE] — only switch if there's no code being pasted
  if (/(?<!["'])\[MODE:VOICE\]/i.test(text) && !hasCode) { 
    clean = clean.replace(/\[MODE:VOICE\]/gi, ''); 
    if (state.screen !== 'voice') setTimeout(() => showScreen('voice'), 500); 
  }
  
  // UI Controls
  if (text.match(/\[OPEN_IDE\]/i))  { clean = clean.replace(/\[OPEN_IDE\]/gi,  ''); setTimeout(()=> toggleIDE(true), 500); }
  if (text.match(/\[CLOSE_IDE\]/i)) { clean = clean.replace(/\[CLOSE_IDE\]/gi, ''); setTimeout(()=> $('idePane').classList.add('hidden'), 500); }
  if (text.match(/\[OPEN_STORAGE\]/i)) { clean = clean.replace(/\[OPEN_STORAGE\]/gi, ''); setTimeout(()=>{updateStorageUI(); $('storageModal').classList.remove('hidden');}, 500); }
  
  // Background Changes
  const bgMatch = text.match(/\[SET_BG:([^\]]+)\]/i);
  if (bgMatch) {
    clean = clean.replace(bgMatch[0], '');
    const bgName = bgMatch[1].trim();
    applyWallpaper(bgName);
  }
  
  // Wallpaper Blur
  const blurMatch = text.match(/\[SET_BG_BLUR:([^\]]+)\]/i);
  if (blurMatch) {
    clean = clean.replace(blurMatch[0], '');
    const bval = parseInt(blurMatch[1], 10);
    if (!isNaN(bval)) {
        cfg.wallpaperBlur = bval;
        localStorage.setItem('luna_wallpaperBlur', bval);
        applyWallpaperBlur();
    }
  }

  // Wallpaper Picker
  if (text.match(/\[OPEN_WALLPAPER_PICKER\]/i)) {
    clean = clean.replace(/\[OPEN_WALLPAPER_PICKER\]/gi, '');
    setTimeout(() => openWallpaperPicker(), 400);
  }
  
  // ─── THE IMPROVED SYNC ENGINE ───
  // Support standard backticks
  let codeBlocks = [...text.matchAll(/```(?:[a-zA-Z]*)\n?([\s\S]*?)(?:```|$)/g)];

  if (codeBlocks.length > 0) {
    let codeToSync = codeBlocks.map(block => block[1].trim()).join('\n\n');
    
    // Only auto-open IDE if the code is actually substantial (more than 15 chars)
    if (codeToSync.length > 15) {
      console.log("[LUNA] Substantial code detected. Auto-Sync Triggered.");
      setTimeout(() => {
        toggleIDE(true);
        setTimeout(() => {
          if (ensureIDE()) {
            monacoEditor.setValue(codeToSync);
            monacoEditor.refresh();
            showToast('✅ All Code Synced to IDE');
          }
        }, 1000);
      }, 500);
    }
  }
  
  // FINAL CLEANUP: Ensure NO tags are visible in the chat bubble
  let finalClean = clean.replace(/\[PASTE_CODE(?::([a-zA-Z]*))?\]/gi, '');
  finalClean = finalClean.replace(/\[OPEN_IDE\]/gi, '');
  finalClean = finalClean.replace(/\[CLOSE_IDE\]/gi, '');
  finalClean = finalClean.replace(/\[OPEN_STORAGE\]/gi, '');
  finalClean = finalClean.replace(/\[OPEN_WALLPAPER_PICKER\]/gi, '');
  finalClean = finalClean.replace(/\[SET_BG:[^\]]+\]/gi, '');
  finalClean = finalClean.replace(/\[SET_BG_BLUR:[^\]]+\]/gi, '');
  finalClean = finalClean.replace(/\[MODE:(?:CHAT|VOICE)\]/gi, '');
  
  return finalClean.trim();
}

async function sendMessage() {
  const text = $('msgInput').value.trim();
  if (!text) return;
  $('msgInput').value = ''; $('msgInput').style.height = 'auto';
  addBubble('user', text);
  
  if (state.waitingForPythonInput) {
    state.waitingForPythonInput = false;
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PYTHON_INPUT_REPLY', answer: text });
    }
    if ($('msgInput')) $('msgInput').placeholder = 'Ask Luna anything…';
    return;
  }

  const lowerText = text.toLowerCase();
  const exactTyped = text.trim().toLowerCase();
  // Specific voice-switch phrases (typed in chat input or sent via voice-in-chat)
  const VOICE_SWITCH_PHRASES = ['voice mode','switch to voice','go to voice','switch to voice mode','go to voice mode','change to voice','enable voice mode'];
  const SLEEP_PHRASES = ['sleep','go to sleep','goodnight','luna sleep','deactivate'];
  if (VOICE_SWITCH_PHRASES.some(p => exactTyped.includes(p))) {
    addBubble('luna', 'Switching to Voice Mode...');
    setTimeout(() => showScreen('voice'), 800);
    return;
  }
  const WP_BROWSE_PHRASES = ['open wallpaper picker', 'open wallpaper manager', 'browse wallpapers', 'choose wallpaper manager', 'manage wallpapers'];
  if (WP_BROWSE_PHRASES.some(p => exactTyped.includes(p))) {
    openWallpaperPicker();
    addBubbleReveal('luna', 'Opening Wallpaper Manager...');
    return;
  }
  if (SLEEP_PHRASES.some(p => exactTyped.includes(p))) {
    sleepLuna();
    return;
  }
  if (lowerText.includes('open console') || lowerText.includes('open ide')) {
    toggleIDE(true);
    addBubbleReveal('luna', 'IDE Console is now open. What are we building today?');
    return;
  }
  if (lowerText.includes('close console') || lowerText.includes('close ide')) {
    $('idePane').classList.add('hidden');
    addBubbleReveal('luna', 'IDE Console closed.');
    return;
  }
  if (lowerText.includes('open storage') || lowerText.includes('open data bank')) {
    updateStorageUI(); $('storageModal').classList.remove('hidden');
    addBubbleReveal('luna', 'Data Bank is open. Drop your files in!');
    return;
  }
  if (lowerText.includes('switch to gemini') || lowerText.includes('switch to google')) {
    cfg.engine = 'gemini'; localStorage.setItem('luna_engine', 'gemini');
    if($('activeEngine')) $('activeEngine').value = 'gemini';
    addBubbleReveal('system', 'Engine switched to Primary (Google Gemini).');
    return;
  }
  if (lowerText.includes('switch to groq') || lowerText.includes('switch to llama')) {
    cfg.engine = 'groq'; localStorage.setItem('luna_engine', 'groq');
    if($('activeEngine')) $('activeEngine').value = 'groq';
    addBubbleReveal('system', 'Engine switched to Backup (Groq Llama).');
    return;
  }
  if (lowerText.includes('auto engine') || lowerText.includes('switch to auto')) {
    cfg.engine = 'auto'; localStorage.setItem('luna_engine', 'auto');
    if($('activeEngine')) $('activeEngine').value = 'auto';
    addBubbleReveal('system', 'Engine switched to Auto-Failover Mode.');
    return;
  }
  
  $('typingIndicator').classList.remove('hidden');
  $('sendBtn').disabled = true;
  
  const reply = await callAI(text);
  
  $('typingIndicator').classList.add('hidden');
  $('sendBtn').disabled = false;
  
  const clean = parseAICommands(reply);
  if(clean) addBubbleReveal('luna', clean);
  // Clear image attachment after sending
  if (attachedImageBase64) clearImageAttachment();
}

$('sendBtn').addEventListener('click', sendMessage);
$('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ─── Brain Activity Logic ─────────────────────────────────
function startBrainActivity() {
  const pulse = $('neuralPulse');
  if (pulse) {
      pulse.classList.remove('active');
      void pulse.offsetWidth; // Force reflow
      pulse.classList.add('active');
  }
}

function stopBrainActivity() {
  // Neural pulse automatically fades out via CSS keyframes
}

// ─── AI Engines (Gemini & Groq) ───────────────────────────
async function callAI(userText) {
  state.history.push({ role: 'user', text: userText });
  saveHistory();
  const engine = cfg.engine === 'auto' ? (cfg.geminiKey ? 'gemini' : 'groq') : cfg.engine;
  
  // Combine core prompt with user custom prompt intelligently based on context
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
    if (engine === 'gemini' && cfg.groqKey) {
      console.warn('Gemini failed, falling back to Groq...', err);
      showToast(`⚠️ Gemini Limit Hit. Auto-routing to Backup Engine...`, false);
      try { 
        let reply = await callGroq(userText, sysPrompt, state.groqIdx); 
        stopBrainActivity();
        state.history.push({ role: 'model', text: reply });
        saveHistory();
        return reply;
      } catch (e) { 
        stopBrainActivity();
        showToast(`❗ Both Engines Offline. Check keys.`, true);
        return `❗ Both engines failed. Please check your keys or select a different model.`; 
      }
    }
    stopBrainActivity();
    return `❗ Engine Error: ${err.message}`;
  }
}

async function callGemini(userText, sysPrompt, keyIndex = -1) {
  let allBackupKeys = cfg.geminiKeys.split('\n').map(k => k.trim()).filter(k => k);
  let key = cfg.geminiKey;
  if (keyIndex >= 0 && keyIndex < allBackupKeys.length) {
    key = allBackupKeys[keyIndex];
  }
  const url = `${GEMINI_BASE}/${cfg.geminiModel}:generateContent?key=${key}`;
  
  // Build user parts — text + optional image
  const userParts = [];
  if (attachedImageBase64 && attachedImageMime) {
    userParts.push({ inlineData: { mimeType: attachedImageMime, data: attachedImageBase64 } });
  }
  userParts.push({ text: userText });
  
    let cleanHistory = [];
    state.history.slice(-4, -1).forEach(m => {
      const role = m.role === 'user' ? 'user' : 'model';
      // TOKEN OPTIMIZATION: Truncate past messages to 800 chars to prevent infinite token loops
      const truncatedText = m.text.substring(0, 800);
      if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === role) {
        cleanHistory[cleanHistory.length - 1].parts[0].text += '\n\n' + truncatedText;
      } else {
        cleanHistory.push({ role, parts: [{ text: truncatedText }] });
      }
    });

  const contents = [
    { role: 'user', parts: [{ text: sysPrompt }] },
    { role: 'model', parts: [{ text: 'Acknowledged.' }] },
    ...cleanHistory,
    { role: 'user', parts: userParts }
  ];

  const body = { 
    contents,
    generationConfig: {
      maxOutputTokens: 8192, // Force max output for long code
      temperature: 0.7
    }
  };
  // Google Search grounding disabled to prevent massive background token waste
  // if (!attachedImageBase64) {
  //   body.tools = [{ googleSearch: {} }];
  // }

  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  
  // If rate limited, not found, or server error, try with backup key
  if (data.error) {
    const errStr = String(data.error.message || '').toLowerCase();
    if (data.error.code === 429 || data.error.status === 'RESOURCE_EXHAUSTED' || data.error.code === 404 || data.error.status === 'NOT_FOUND' || errStr.includes('quota') || errStr.includes('exhausted')) {
      let allBackupKeys = cfg.geminiKeys.split(/[\n,; ]+/).map(k => k.trim()).filter(k => k);
      if (keyIndex + 1 < allBackupKeys.length) {
        state.geminiIdx = keyIndex + 1;
        localStorage.setItem('luna_geminiIdx', state.geminiIdx);
        console.log(`🔄 Gemini key exhausted. Rotating silently to Backup Key ${state.geminiIdx + 1}...`);
        return callGemini(userText, sysPrompt, state.geminiIdx);
      } else {
        showToast(`⚠️ Gemini Quota Exhausted. No alternate keys left.`, true);
      }
    }
    throw new Error(data.error.message);
  }
  
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '…';
  state.history.push({ role: 'model', text: reply });
  updateTokens(data.usageMetadata?.totalTokenCount || 0);
  return reply;
}

async function callGroq(userText, sysPrompt, keyIndex = -1, dropHistory = false) {
  let allBackupKeys = cfg.groqKeys.split('\n').map(k => k.trim()).filter(k => k);
  let key = cfg.groqKey;
  if (keyIndex >= 0 && keyIndex < allBackupKeys.length) {
    key = allBackupKeys[keyIndex];
  }
  let cleanMessages = [{ role: 'system', content: sysPrompt }];
  if (!dropHistory) {
    state.history.slice(-4, -1).forEach(m => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      // TOKEN OPTIMIZATION: Truncate past messages to 800 chars
      const truncatedText = m.text.substring(0, 800);
      if (cleanMessages[cleanMessages.length - 1].role === role) {
        cleanMessages[cleanMessages.length - 1].content += '\n\n' + truncatedText;
      } else {
        cleanMessages.push({ role, content: truncatedText });
      }
    });
  }
  cleanMessages.push({ role: 'user', content: userText });

  const messages = cleanMessages;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: cfg.groqModel, messages, max_tokens: 8192, temperature: 0.7 }),
  });
  const data = await res.json();
  
  // If rate limited and backup key exists, retry with backup
  if (data.error) {
    const errMsg = String(data.error.message || '').toLowerCase();
    // If it's a token size limit, drop history and retry immediately on the SAME key
    if (!dropHistory && (errMsg.includes('request too large') || errMsg.includes('tokens per minute') || errMsg.includes('tpm') || errMsg.includes('rate_limit'))) {
      console.log(`⚠️ Groq limit hit. Dropping chat history context...`);
      return callGroq(userText, sysPrompt, keyIndex, true);
    }
    
    if (data.error.code === 429 || errMsg.includes('rate_limit') || errMsg.includes('quota')) {
      let allBackupKeys = cfg.groqKeys.split(/[\n,; ]+/).map(k => k.trim()).filter(k => k);
      if (keyIndex + 1 < allBackupKeys.length) {
        state.groqIdx = keyIndex + 1;
        localStorage.setItem('luna_groqIdx', state.groqIdx);
        console.log(`🔄 Groq exhausted. Rotating silently to Backup Key ${state.groqIdx + 1}...`);
        return callGroq(userText, sysPrompt, state.groqIdx);
      }
    }
    throw new Error(data.error.message);
  }
  
  const reply = data.choices?.[0]?.message?.content ?? '…';
  state.history.push({ role: 'model', text: reply });
  updateTokens(data.usage?.total_tokens || 0);
  return reply;
}

function updateTokens(count) {
  state.totalTokens += count;
  localStorage.setItem('luna_totalTokens', state.totalTokens);
  
  $('tokenRead').textContent = `${state.totalTokens.toLocaleString()} (+${count})`;
  $('tokenCount').textContent = `Total: ${state.totalTokens.toLocaleString()} | Last: +${count}`;
  
  // Analytics
  state.usageLog.push({ ts: Date.now(), count: count });
  state.usageLog = state.usageLog.filter(l => l.ts > Date.now() - 30*86400000);
  localStorage.setItem('luna_usageLog', JSON.stringify(state.usageLog));
  updateAnalyticsUI();
}

// ─── Chat UI Helpers ──────────────────────────────────────
function formatText(t) {
  if (!t) return '';
  
  // Robust Markdown Code Block Detection
  // This handles everything from perfect blocks to broken/unclosed ones
  let processed = t.replace(/```([\s\S]*?)(?:```|$)/g, (match, code) => {
    // Escape HTML to prevent rendering bugs
    const safeCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="chat-code-wrap"><pre>${safeCode.trim()}</pre></div>`;
  });

  // Handle bold and newlines
  return processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br>');
}

window.forceSyncCode = function(code) {
  toggleIDE(true);
  setTimeout(() => {
    if (ensureIDE()) {
      monacoEditor.setValue(code);
      monacoEditor.refresh();
      showToast('⚡ Code Force-Synced!');
    }
  }, 400);
};

function addBubble(sender, text) {
  if(sender === 'system') {
    // Legacy support: redirect old system bubbles to toasts if any slipped through
    showToast(text);
    return;
  }
  const isLuna = sender === 'luna';
  const row = document.createElement('div'); row.className = `bubble-row${isLuna?'':' user-row'}`;
  row.innerHTML = `
    ${isLuna ? `<div class="avatar la" style="background:transparent;box-shadow:none;"><div class="mini-orb-wrap" style="transform: scale(0.65);"><div class="mini-ring"></div><div class="mini-orb-core"></div></div></div>` : ''}
    <div class="bubble-col${isLuna?'':' uc'}">
      <span class="sender-name">${isLuna ? 'LUNA' : 'YOU'}</span>
      <div class="bubble ${isLuna ? 'lb' : 'ub'}">${formatText(text)}</div>
    </div>
    ${!isLuna ? `<div class="avatar ua">👤</div>` : ''}
  `;
  $('messages').appendChild(row); $('messages').scrollTop = $('messages').scrollHeight;
}

function addBubbleReveal(sender, text) {
  const isLuna = sender === 'luna';
  const row = document.createElement('div'); row.className = `bubble-row${isLuna?'':' user-row'}`;
  row.innerHTML = `
    ${isLuna ? `<div class="avatar la" style="background:transparent;box-shadow:none;"><div class="mini-orb-wrap" style="transform: scale(0.65);"><div class="mini-ring"></div><div class="mini-orb-core"></div></div></div>` : ''}
    <div class="bubble-col${isLuna?'':' uc'}">
      <span class="sender-name">${isLuna ? 'LUNA' : 'YOU'}</span>
      <div class="bubble ${isLuna ? 'lb' : 'ub'}">${formatText(text)}</div>
    </div>
  `;
  $('messages').appendChild(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function addWelcomeIfEmpty() {
  if ($('messages').children.length === 0) {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('chatGreeting').textContent = `${greet}!`;
    addBubbleReveal('luna', `${greet}! I'm **Luna**, your AI companion.`);
  }
}

// ─── Settings & Setup ──────────────────────────────────────
$('toChatBtn').addEventListener('click', () => showScreen('chat'));
$('toVoiceBtn').addEventListener('click', () => showScreen('voice'));
$('chatVoiceBtn').addEventListener('click', () => {
    if(state.listening) { stopListening(); $('chatVoiceBtn').style.color = ''; }
    else { startListening(); $('chatVoiceBtn').style.color = 'var(--blue)'; }
});
$('clearBtn').addEventListener('click', () => {
  $('messages').innerHTML = ''; state.history = [];
  if (typeof clearImageAttachment === 'function') clearImageAttachment();
});

function openSettings() {
  $('geminiKey').value = cfg.geminiKey;
  if($('geminiKeys')) $('geminiKeys').value = cfg.geminiKeys;
  $('geminiModel').value = cfg.geminiModel;
  $('groqKey').value = cfg.groqKey;
  if($('groqKeys')) $('groqKeys').value = cfg.groqKeys;
  $('groqModel').value = cfg.groqModel;
  if($('activeEngine')) $('activeEngine').value = cfg.engine;
  if($('geminiModel')) $('geminiModel').value = cfg.geminiModel;
  if($('systemPrompt')) $('systemPrompt').value = cfg.systemPrompt;
  $('wakeWord').value = cfg.wakeWord;
  $('settingsModal').classList.remove('hidden');
}
const closeSettings = () => $('settingsModal').classList.add('hidden');

$('settingsBtn').addEventListener('click', openSettings);
$('voiceSettingsBtn').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
$('cancelSettings').addEventListener('click', closeSettings);

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
  if($('rememberHistory')) cfg.rememberHistory = $('rememberHistory').checked;
  cfg.wallpaperBlur = parseInt($('wpBlurRange').value, 10);
  
  Object.keys(cfg).forEach(k => localStorage.setItem(`luna_${k}`, cfg[k]));
  
  // Reset key indexes so it starts fresh with the new keys
  state.geminiIdx = -1;
  state.groqIdx = -1;
  localStorage.setItem('luna_geminiIdx', -1);
  localStorage.setItem('luna_groqIdx', -1);
  
  applyWallpaperBlur();
  closeSettings();
  showToast('⚙️ Settings saved. API Keys reset.');
});

// History Event Listeners
if($('historyBtn')) $('historyBtn').addEventListener('click', () => {
  loadHistoryUI();
  $('historyModal').classList.remove('hidden');
});
if($('closeHistory')) $('closeHistory').addEventListener('click', () => $('historyModal').classList.add('hidden'));
if($('newChatBtn')) $('newChatBtn').addEventListener('click', () => {
  currentSessionId = Date.now();
  state.history = [];
  $('messages').innerHTML = '';
  if (typeof clearImageAttachment === 'function') clearImageAttachment();
  $('historyModal').classList.add('hidden');
});
if($('clearMemoryBtn')) $('clearMemoryBtn').addEventListener('click', () => {
  if(confirm('Wipe all history and token data?')) {
    localStorage.removeItem('luna_sessions');
    localStorage.removeItem('luna_usageLog');
    location.reload();
  }
});

// Storage Events
if($('storageBtn')) $('storageBtn').onclick = () => { updateStorageUI(); $('storageModal').classList.remove('hidden'); };
if($('closeStorage')) $('closeStorage').onclick = () => $('storageModal').classList.add('hidden');
if($('clearStorageBtn')) $('clearStorageBtn').onclick = () => { storageData=[]; localStorage.setItem('luna_storage', '[]'); updateStorageUI(); };
if($('dropZone')) {
  const drop = $('dropZone');
  drop.ondragover = e => { e.preventDefault(); drop.style.borderColor = 'var(--blue)'; };
  drop.ondragleave = e => { e.preventDefault(); drop.style.borderColor = 'var(--border)'; };
  drop.ondrop = e => { e.preventDefault(); drop.style.borderColor = 'var(--border)'; handleFileUpload(e.dataTransfer.files); };
  drop.onclick = () => $('fileUpload').click();
  $('fileUpload').onchange = e => handleFileUpload(e.target.files);
}

// ─── Memory System ─────────────────────────────────────────
let lunaMemory = JSON.parse(localStorage.getItem('luna_memory') || '[]');

function saveMemory() { localStorage.setItem('luna_memory', JSON.stringify(lunaMemory)); }

function renderMemoryList() {
  const list = $('memoryList');
  if (!list) return;
  list.innerHTML = '';
  if (lunaMemory.length === 0) {
    list.innerHTML = '<div style="color:var(--dim);font-size:0.8rem;text-align:center;padding:10px;">No memories yet. Add something!</div>';
    return;
  }
  lunaMemory.forEach((item, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--border);font-size:0.82rem;color:var(--text);';
    row.innerHTML = `<span style="color:var(--blue)">🧠</span><span style="flex:1">${item}</span><button onclick="deleteMemory(${i})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:0.9rem;">✕</button>`;
    list.appendChild(row);
  });
}

window.deleteMemory = function(i) {
  lunaMemory.splice(i, 1);
  saveMemory();
  renderMemoryList();
};

if ($('memoryBtn')) $('memoryBtn').onclick = () => { renderMemoryList(); $('memoryModal').classList.remove('hidden'); };
if ($('closeMemory')) $('closeMemory').onclick = () => $('memoryModal').classList.add('hidden');
if ($('addMemoryBtn')) $('addMemoryBtn').onclick = () => {
  const val = $('memoryInput').value.trim();
  if (!val) return;
  lunaMemory.push(val);
  saveMemory(); renderMemoryList();
  $('memoryInput').value = '';
};
if ($('memoryInput')) $('memoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('addMemoryBtn').click(); });
if ($('clearMemoryItemsBtn')) $('clearMemoryItemsBtn').onclick = () => { lunaMemory = []; saveMemory(); renderMemoryList(); };

// ─── Image Analysis ─────────────────────────────────────────
let attachedImageBase64 = null;
let attachedImageMime = null;

window.clearImageAttachment = function() {
  attachedImageBase64 = null; attachedImageMime = null;
  $('imagePreviewBar').style.display = 'none';
  $('imageThumb').src = '';
  $('imgUploadInput').value = '';
};

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    attachedImageBase64 = dataUrl.split(',')[1];
    attachedImageMime = file.type;
    $('imageThumb').src = dataUrl;
    $('imagePreviewLabel').textContent = file.name + ' · ' + (file.size/1024).toFixed(1) + 'kb';
    $('imagePreviewBar').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

if ($('imgUploadBtn')) $('imgUploadBtn').onclick = () => $('imgUploadInput').click();
if ($('imgUploadInput')) $('imgUploadInput').onchange = e => handleImageFile(e.target.files[0]);

// Paste image from clipboard
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      handleImageFile(item.getAsFile());
      break;
    }
  }
});

// Drag image onto chat input
const msgInput = $('msgInput');
if (msgInput) {
  msgInput.addEventListener('dragover', e => { e.preventDefault(); msgInput.style.borderColor = 'var(--blue)'; });
  msgInput.addEventListener('dragleave', () => { msgInput.style.borderColor = ''; });
  msgInput.addEventListener('drop', e => {
    e.preventDefault(); msgInput.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageFile(file);
  });
}

// Function to ensure IDE is initialized
function ensureIDE() {
  if (monacoEditor) return true;
  if (!window.CodeMirror) {
    console.warn("[LUNA] CodeMirror library not loaded yet...");
    return false;
  }
  
  const container = document.getElementById('monacoContainer');
  if (!container) return false;
  
  monacoEditor = CodeMirror(container, {
    value: '// LUNA ENGINE: RESILIENT MODE ACTIVE\n// Your code will arrive here automatically.\n\nconsole.log("Luna is ready and synced.");',
    mode: 'javascript',
    theme: 'material-palenight',
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    smartIndent: true,
    indentUnit: 4
  });
  monacoEditor.setSize("100%", "100%");
  console.log("[LUNA] IDE Editor Initialized.");
  return true;
}

// Initialize on start if possible, otherwise it will try again when opened
setTimeout(ensureIDE, 1000);

// Shared IDE toggle helper
function toggleIDE(forceOpen) {
  const pane = $('idePane');
  if (!pane) return;
  const isHidden = pane.classList.contains('hidden');
  if (forceOpen === true || (forceOpen === undefined && isHidden)) {
    pane.classList.remove('hidden');
    // Ensure editor exists when we open the pane
    ensureIDE();
  } else {
    pane.classList.add('hidden');
  }
  if (monacoEditor) setTimeout(() => monacoEditor.refresh(), 150);
}

// IDE Events
if($('consoleBtn'))      $('consoleBtn').onclick      = () => toggleIDE();
if($('voiceConsoleBtn')) $('voiceConsoleBtn').onclick  = () => toggleIDE();
if($('ideCloseBtn'))     $('ideCloseBtn').onclick      = () => $('idePane').classList.add('hidden');
if($('ideFullscreenBtn')) $('ideFullscreenBtn').onclick = () => {
  $('idePane').classList.toggle('fullscreen');
  if(monacoEditor) setTimeout(()=>monacoEditor.refresh(), 100);
};
if($('ideHelpBtn')) $('ideHelpBtn').onclick = () => {
  if(!monacoEditor) return;
  const code = monacoEditor.getValue();
  if(code.trim().length === 0) return;
  const prompt = `Please debug and fix this code:\n\`\`\`\n${code}\n\`\`\``;
  if (state.screen === 'voice') {
    // In voice mode: show transcript and process via voice chat
    if($('voiceTranscript')) $('voiceTranscript').textContent = 'Debug code...';
    processVoiceChat(prompt);
  } else {
    // In chat mode: put in input and send
    $('msgInput').value = prompt;
    sendMessage();
  }
};
if($('ideSaveBtn')) $('ideSaveBtn').onclick = () => {
  if(!monacoEditor) return;
  const code = monacoEditor.getValue();
  const lang = $('ideLangSelect') ? $('ideLangSelect').value : 'js';
  const ext = lang === 'python' ? 'py' : lang === 'html' ? 'html' : 'js';
  const name = `script_${new Date().getTime()}.${ext}`;
  storageData.push({ name: name, content: code });
  localStorage.setItem('luna_storage', JSON.stringify(storageData));
  updateStorageUI();
  addBubble('system', `Code saved to Data Bank as ${name}`);
};
// Language selector wiring
if ($('ideLangSelect')) {
  $('ideLangSelect').addEventListener('change', () => {
    const val = $('ideLangSelect').value;
    if (!monacoEditor) return;
    if (val === 'python') monacoEditor.setOption('mode', 'python');
    else if (val === 'html') monacoEditor.setOption('mode', 'xml');
    else monacoEditor.setOption('mode', 'javascript');
  });
}
let pyWorker = null;
let pyodideReady = false;

async function setupPythonWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        // If there's no controller, the page needs a reload to be controlled
        console.warn("Service worker registered but not controlling. Input intercept might fail on first load.");
      }
    } catch(e) {
      console.error('Service Worker registration failed:', e);
    }
  }

  pyWorker = new Worker('py-worker.js');
  pyWorker.onmessage = e => {
    if (e.data.type === 'STATUS') {
      setPyStatus(e.data.status);
      if (e.data.status === 'ready') pyodideReady = true;
    } else if (e.data.type === 'RUN_DONE') {
      state.pythonRunning = false;
      if (e.data.error) addBubble('system', '🐍 Python Error:\n' + e.data.error);
      else if (e.data.output) addBubble('system', '🐍 Python Output:\n' + e.data.output.trim());
      else addBubble('system', '🐍 Python ran with no output.');
    }
  };
}

navigator.serviceWorker.addEventListener('message', event => {
  if (event.data.type === 'PYTHON_INPUT_REQUEST') {
    state.waitingForPythonInput = true;
    const promptText = event.data.prompt || 'Input required:';
    addBubble('luna', `🐍 Python needs input:\n**${promptText}**`);
    
    if ($('msgInput')) {
        $('msgInput').placeholder = `Type answer for: ${promptText}...`;
        $('msgInput').focus();
    }

    if (state.screen === 'voice') {
       speak('Python needs input: ' + promptText);
       $('voiceGreeting').textContent = 'Waiting for input…';
    }
  }
});

setupPythonWorker();

if($('ideRunBtn')) $('ideRunBtn').onclick = async () => {
  if(!monacoEditor) return;
  const code = monacoEditor.getValue().trim();
  if(!code) return;

  // ── Language Detection ──────────────────────────────────
  // HTML: starts with < tag or doctype
  const isHTML = /^(<(!DOCTYPE|html|head|body|div|span|p|h[1-6]|script|style|link|meta|ul|ol|li|table|form|input|button|canvas|svg)[\s>]|<!--)/i.test(code);

  // Python: explicit mode OR uses Python-specific syntax anywhere in code
  const isPython = !isHTML && (
    monacoEditor.getOption('mode') === 'python' ||
    /\bprint\s*\(/.test(code) ||
    /^[ \t]*(import |from |def |class |elif |async def|#!\/usr\/bin\/env python)/m.test(code) ||
    /:\s*$/.test(code.split('\n').find(l => /^\s*(def |class |if |for |while |elif |else|try|except|with )/.test(l)) || '') ||
    /^\s*@/.test(code)
  );

  // Auto-switch editor syntax highlighting to match
  if (isHTML && monacoEditor.getOption('mode') !== 'htmlmixed') {
    // CodeMirror doesn't have htmlmixed loaded, use xml as fallback silently
  } else if (isPython && monacoEditor.getOption('mode') !== 'python') {
    monacoEditor.setOption('mode', 'python');
  } else if (!isPython && !isHTML && monacoEditor.getOption('mode') !== 'javascript') {
    monacoEditor.setOption('mode', 'javascript');
  }

  // ── HTML Runner ─────────────────────────────────────────
  if (isHTML) {
    let preview = $('htmlPreviewFrame');
    if (!preview) {
      // Create a floating preview iframe
      const wrap = document.createElement('div');
      wrap.id = 'htmlPreviewWrap';
      wrap.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);width:min(800px,90vw);height:60vh;background:#fff;border:2px solid var(--blue);border-radius:12px;z-index:9999;box-shadow:0 20px 60px rgba(0,0,0,0.7);overflow:hidden;display:flex;flex-direction:column;';
      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:#0a0e1a;border-bottom:1px solid var(--border);flex-shrink:0;">
          <span style="font-family:'Orbitron',sans-serif;font-size:0.65rem;letter-spacing:2px;color:var(--blue);">🌐 HTML PREVIEW</span>
          <button onclick="document.getElementById('htmlPreviewWrap').remove()" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:1.1rem;">✕</button>
        </div>
        <iframe id="htmlPreviewFrame" sandbox="allow-scripts allow-same-origin" style="flex:1;border:none;width:100%;background:#fff;"></iframe>
      `;
      document.body.appendChild(wrap);
      preview = $('htmlPreviewFrame');
    }
    // Write HTML into iframe
    const doc = preview.contentDocument || preview.contentWindow.document;
    doc.open(); doc.write(code); doc.close();
    addBubble('system', '🌐 HTML rendered in preview panel.');
    return;
  }

  // ── Python Runner ────────────────────────────────────────
  if (isPython) {
    if (!pyWorker || !pyodideReady) {
      addBubble('system', '🐍 Python engine is still loading — give it a sec and try again!');
      return;
    }
    if (state.pythonRunning) {
      addBubble('system', '🐍 Python is already running a script.');
      return;
    }
    state.pythonRunning = true;
    pyWorker.postMessage({ type: 'RUN_CODE', code: code });
    return;
  }

  // ── JavaScript Runner ────────────────────────────────────
  {
    const output = [];
    // Polyfills so print/println/alert work like console.log in eval context
    const _print  = (...args) => output.push(args.map(String).join(' '));
    const _oldLog = console.log;
    const _oldWarn = console.warn;
    const _oldErr  = console.error;
    console.log   = (...args) => output.push(args.map(String).join(' '));
    console.warn  = (...args) => output.push('⚠ ' + args.map(String).join(' '));
    console.error = (...args) => output.push('❌ ' + args.map(String).join(' '));
    try {
      // Inject print polyfill into the eval scope via Function constructor
      const runner = new Function('print', 'println', 'console',
        `"use strict";\n${code}`
      );
      const result = runner(_print, _print, { log: _print, warn: _print, error: _print });
      if (output.length > 0) {
        addBubble('system', '⚡ JS Output:\n' + output.join('\n'));
      } else if (result !== undefined) {
        addBubble('system', '⚡ JS Result: ' + String(result));
      } else {
        addBubble('system', '⚡ JS ran with no output.');
      }
    } catch(e) {
      addBubble('system', '⚡ JS Error: ' + e.message);
    } finally {
      console.log   = _oldLog;
      console.warn  = _oldWarn;
      console.error = _oldErr;
    }
  }
};


document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', e => {
  document.querySelectorAll('.tab, .tab-panel').forEach(el => el.classList.remove('active'));
  e.target.classList.add('active');
  $(`tab-${e.target.dataset.tab}`).classList.add('active');
}));

// Populate Gemini Models
const gModels = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite-001', name: 'Gemini 2.0 Flash Lite' }
];
gModels.forEach(m => {
  const o = document.createElement('option'); 
  o.value = m.id; 
  o.textContent = m.name;
  if (m.id === cfg.geminiModel) o.selected = true;
  $('geminiModel').appendChild(o);
});

// Background Wake Word
(function bgWake() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return;
  const r = new SR(); r.continuous = true; r.lang = 'en-US';
  r.onresult = e => {
    const t = e.results[e.results.length-1][0].transcript.toLowerCase();
    if(!state.awake && (t.includes(cfg.wakeWord) || t.includes('wake up luna'))) wake();
  };
  r.onend = () => { if(!state.awake) try{r.start();}catch(e){} };
  try{r.start();}catch(e){}
})();

function wrapLetters(str, delayOffset = 0) {
  return str.split('').map((char, i) => {
    if (char === ' ') return '&nbsp;';
    return `<span class="holo-char" style="animation-delay: ${delayOffset + i * 0.03}s">${char}</span>`;
  }).join('');
}

let activeHoloClock = null;

function renderHoloClock(screenName) {
  if (activeHoloClock) activeHoloClock.remove();
  
  const screenId = screenName + 'Screen';
  const wrap = $(screenId)?.querySelector('.orb-canvas-wrap');
  if (!wrap) return;

  const orb = wrap.querySelector('canvas');
  const lineLen = orb ? (orb.width / 2 + 20) + 'px' : '130px';

  const clockDiv = document.createElement('div');
  clockDiv.className = 'holo-clock';
  if (screenName === 'chat') clockDiv.classList.add('is-chat');
  clockDiv.style.setProperty('--line-len', lineLen);
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  clockDiv.innerHTML = `
    <div class="holo-line"></div>
    <div class="holo-bracket">
      <div class="holo-bracket-side"></div>
      <div class="holo-date" id="holoDate">${wrapLetters(dateStr, 1.2)}</div>
      <div class="holo-time" id="holoTime">${wrapLetters(timeStr, 1.5)}</div>
    </div>
  `;
  
  wrap.appendChild(clockDiv);
  activeHoloClock = clockDiv;

  if (screenName === 'chat') {
     // Wait for layout
     setTimeout(() => {
         const rect = wrap.getBoundingClientRect();
         const startX = rect.left + rect.width / 2;
         const startY = rect.top + rect.height / 2;
         
         clockDiv.style.left = startX + 'px';
         clockDiv.style.top = startY + 'px';

         // Trigger flight after initial animation completes (3 seconds)
         setTimeout(() => {
            if (activeHoloClock === clockDiv) {
                clockDiv.classList.add('fly-to-corner');
                // Centralize it at the top of the screen
                clockDiv.style.left = '50%';
                clockDiv.style.transform = 'translateX(-50%)';
                clockDiv.style.top = '15px';
            }
         }, 3000);
     }, 50);
  }
}

function showToast(message, isError = false) {
  let toast = document.getElementById('luna-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'luna-toast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 10, 25, 0.9); color: #fff; padding: 12px 24px;
      border-radius: 8px; border: 1px solid rgba(0,180,255,0.4);
      box-shadow: 0 4px 20px rgba(0,0,0,0.5); font-size: 0.85rem;
      z-index: 10000; opacity: 0; transition: opacity 0.3s, top 0.3s;
      pointer-events: none; text-align: center; max-width: 90%;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = message;
  toast.style.borderColor = isError ? 'rgba(255,50,50,0.6)' : 'rgba(0,180,255,0.4)';
  toast.style.top = '30px';
  toast.style.opacity = '1';
  
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.top = '20px';
  }, 4000);
}

// Ensure it loads on the sleep screen initially
renderHoloClock('sleep');

// Update the text without animation after the initial spawn
setInterval(() => {
  if (!activeHoloClock) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  
  const timeEl = activeHoloClock.querySelector('#holoTime');
  const dateEl = activeHoloClock.querySelector('#holoDate');
  
  if (timeEl && !timeEl.querySelector('.holo-char')) timeEl.textContent = timeStr;
  else if (timeEl) setTimeout(() => timeEl.textContent = timeStr, 2500);

  if (dateEl && !dateEl.querySelector('.holo-char')) dateEl.textContent = dateStr;
  else if (dateEl) setTimeout(() => dateEl.textContent = dateStr, 2500);
  
}, 1000);

// ─── Wallpaper System ────────────────────────────────────
// Built-in wallpapers
const BUILTIN_WALLPAPERS = [
  { name: 'Naruto 1', file: 'naruto/naruto1.png' },
  { name: 'Naruto 2', file: 'naruto/naruto2.png' },
  { name: 'Naruto 3', file: 'naruto/naruto3.png' },
  { name: 'Naruto 4', file: 'naruto/naruto4.png' },
  { name: 'Naruto 5', file: 'naruto/naruto5.png' },
  { name: 'Naruto 6', file: 'naruto/naruto6.png' },
  { name: 'Naruto 7', file: 'naruto/naruto7.png' },
  { name: 'Naruto 8', file: 'naruto/naruto8.png' },
  { name: 'Naruto 9', file: 'naruto/naruto9.png' },
];

// Apply wallpaper by name or 'default'/'none', and persist to localStorage
const VALID_BUILTIN_FILES = [
  'naruto/naruto1.png','naruto/naruto2.png','naruto/naruto3.png',
  'naruto/naruto4.png','naruto/naruto5.png','naruto/naruto6.png',
  'naruto/naruto7.png','naruto/naruto8.png','naruto/naruto9.png',
  'bg1.png','bg2.png'
];

function resolveWallpaperPath(name) {
  const clean = (name || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!clean) return null;
  
  // 1. Check if it matches built-in files directly or partially
  for (const wp of BUILTIN_WALLPAPERS) {
    const wpFile = wp.file.toLowerCase();
    const wpName = wp.name.toLowerCase().replace(/\s+/g, '');
    
    if (clean === wpFile || 
        clean === wpName || 
        clean === wpName + '.png' || 
        clean === wp.name.toLowerCase() || 
        wpFile.endsWith('/' + clean) || 
        wpFile.endsWith('/' + clean + '.png')) {
      return wp.file;
    }
  }
  
  // 2. Check bg1.png and bg2.png
  if (clean === 'bg1' || clean === 'bg1.png' || clean === 'background1' || clean === 'background1.png') {
    return 'bg1.png';
  }
  if (clean === 'bg2' || clean === 'bg2.png' || clean === 'background2' || clean === 'background2.png') {
    return 'bg2.png';
  }
  
  // 3. Check custom storage wallpapers by name (case-insensitive and whitespace-insensitive, ignoring extension)
  const storageFile = storageData.find(f => {
    const fname = f.name.toLowerCase();
    return fname === clean || 
           fname.replace(/\.[^/.]+$/, '') === clean || 
           fname.replace(/\s+/g, '') === clean;
  });
  if (storageFile) {
    return '__storage__:' + storageFile.name;
  }
  
  return null;
}

function applyWallpaper(name) {
  let trimmed = (name || '').trim();
  if (trimmed.startsWith('__storage__:')) trimmed = trimmed.replace('__storage__:', '');
  const key = trimmed.toLowerCase();
  
  if (key === 'random' || key === 'surprise' || key === 'random wallpaper') {
    const idx = Math.floor(Math.random() * 9) + 1;
    return applyWallpaper(`naruto/naruto${idx}.png`);
  }

  let finalUrl = '';
  let storageKey = trimmed;

  if (key === 'none') {
    finalUrl = 'none';
    storageKey = 'none';
  } else if (key === 'default') {
    finalUrl = "url('naruto/naruto1.png')";
    storageKey = 'naruto/naruto1.png';
  } else {
    // Intelligently resolve any wallpaper name variation first
    const resolved = resolveWallpaperPath(trimmed);
    if (resolved) {
      if (resolved.startsWith('__storage__:')) {
        const cleanName = resolved.replace('__storage__:', '');
        const storageFile = storageData.find(f => f.name === cleanName);
        if (storageFile && storageFile.content.startsWith('data:image')) {
          finalUrl = `url('${storageFile.content}')`;
          storageKey = resolved;
        } else {
          console.warn(`[LUNA] Corrupted image '${trimmed}'. Defaulting to random.`);
          return applyWallpaper('random');
        }
      } else {
        finalUrl = `url('${resolved}')`;
        storageKey = resolved;
      }
    } else {
      // Fallback: search custom storage files
      const storageFile = storageData.find(f => f.name.toLowerCase() === key);
      if (storageFile && storageFile.content.startsWith('data:image')) {
        finalUrl = `url('${storageFile.content}')`;
        storageKey = '__storage__:' + trimmed;
      } else {
        // FAIL-SAFE: If it is a known absolute URL, use it directly
        if (trimmed.includes('://')) {
          finalUrl = `url('${trimmed}')`;
          storageKey = trimmed;
        } else if (trimmed.includes('.')) {
          // NEW FALLBACK: If they type a filename with an extension (e.g. "myimage.png" or "naruto/custom.jpg")
          // try to load it directly! This allows any file name to work.
          finalUrl = `url('${trimmed}')`;
          storageKey = trimmed;
         } else {
          console.warn(`[LUNA] Invalid wallpaper '${trimmed}'. Defaulting to random.`);
          return applyWallpaper('random');
        }
      }
    }
  }

  // Cross-fade logic
  const layer1 = $('wallpaperLayer');
  const layer2 = $('wallpaperLayer2');
  if (!layer1 || !layer2) return;

  const nextLayer = state.currentLayer === 1 ? layer2 : layer1;
  const prevLayer = state.currentLayer === 1 ? layer1 : layer2;

  nextLayer.style.backgroundImage = finalUrl;
  nextLayer.style.opacity = '1';
  prevLayer.style.opacity = '0';
  
  state.currentLayer = state.currentLayer === 1 ? 2 : 1;
  localStorage.setItem('luna_wallpaper', storageKey);
  applyWallpaperBlur();
}

// Restore wallpaper from localStorage on load
(function restoreWallpaper() {
  const saved = localStorage.getItem('luna_wallpaper');
  if (!saved) {
    applyWallpaper('default');
    return;
  }
  applyWallpaper(saved);
})();

function applyWallpaperBlur() {
    const l1 = $('wallpaperLayer');
    const l2 = $('wallpaperLayer2');
    const blur = `blur(${cfg.wallpaperBlur}px)`;
    if (l1) l1.style.filter = blur;
    if (l2) l2.style.filter = blur;
    if ($('wpBlurRange')) $('wpBlurRange').value = cfg.wallpaperBlur;
}
applyWallpaperBlur();

// ─── Wallpaper Picker Modal ───────────────────────────────
let wpSelectedValue = null; // tracks what is selected in the picker

function openWallpaperPicker(lunaMessage) {
  // Build built-in grid
  const builtinGrid = $('wpBuiltinGrid');
  if (builtinGrid) {
    builtinGrid.innerHTML = '';
    const currentWp = localStorage.getItem('luna_wallpaper') || 'naruto/naruto1.png';
    BUILTIN_WALLPAPERS.forEach(wp => {
      const div = document.createElement('div');
      div.className = 'wp-thumb' + (currentWp === wp.file ? ' selected' : '');
      div.dataset.value = wp.file;
      div.innerHTML = `
        <img src="${wp.file}" alt="${wp.name}" loading="lazy" />
        <div class="wp-label">${wp.name}</div>
        <div class="wp-check">✓</div>
      `;
      div.addEventListener('click', () => {
        builtinGrid.querySelectorAll('.wp-thumb').forEach(t => t.classList.remove('selected'));
        $('wpStorageGrid')?.querySelectorAll('.wp-thumb').forEach(t => t.classList.remove('selected'));
        div.classList.add('selected');
        wpSelectedValue = wp.file;
      });
      builtinGrid.appendChild(div);
    });
  }

  // Build storage image grid
  const storageGrid = $('wpStorageGrid');
  const storageLabel = $('wpStorageLabel');
  const imageFiles = storageData.filter(f => f.content && f.content.startsWith('data:image'));
  if (storageGrid) {
    storageGrid.innerHTML = '';
    
    // Always add "Upload New" thumb
    const upThumb = document.createElement('div');
    upThumb.className = 'wp-thumb upload-thumb';
    upThumb.style.cssText = 'border:2px dashed var(--border); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; background:rgba(0,180,255,0.03); cursor:pointer;';
    upThumb.innerHTML = `
      <div style="font-size:1.4rem;">➕</div>
      <div style="font-size:0.65rem; color:var(--dim); font-weight:600; letter-spacing:1px;">UPLOAD</div>
    `;
    upThumb.onclick = () => $('wpUploadInput').click();
    storageGrid.appendChild(upThumb);

    if (imageFiles.length > 0) {
      if (storageLabel) storageLabel.style.display = '';
      const currentWp = localStorage.getItem('luna_wallpaper') || '';
      imageFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'wp-thumb' + (currentWp === '__storage__:' + f.name ? ' selected' : '');
        div.dataset.value = '__storage__:' + f.name;
        div.innerHTML = `
          <img src="${f.content}" alt="${f.name}" />
          <div class="wp-label">${f.name}</div>
          <div class="wp-check">✓</div>
          <button class="wp-del-btn" title="Delete Image" style="position:absolute;top:4px;right:4px;background:rgba(255,0,0,0.7);color:white;border:none;border-radius:4px;width:24px;height:24px;cursor:pointer;font-size:12px;z-index:10;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>
        `;
        div.querySelector('.wp-del-btn').addEventListener('click', (e) => {
          e.stopPropagation(); // prevent select
          const idx = storageData.findIndex(item => item.name === f.name);
          if (idx !== -1) {
            removeStorage(idx);
            if (currentWp === '__storage__:' + f.name) {
              applyWallpaper('naruto/naruto1.png');
              localStorage.setItem('luna_wallpaper', 'naruto/naruto1.png');
            }
            openWallpaperPicker(); // Refresh
          }
        });
        div.addEventListener('click', () => {
          builtinGrid?.querySelectorAll('.wp-thumb').forEach(t => t.classList.remove('selected'));
          storageGrid.querySelectorAll('.wp-thumb').forEach(t => t.classList.remove('selected'));
          div.classList.add('selected');
          wpSelectedValue = '__storage__:' + f.name;
        });
        storageGrid.appendChild(div);
      });
    } else {
      if (storageLabel) storageLabel.style.display = 'none';
    }
  }

  wpSelectedValue = null;
  $('wallpaperModal').classList.remove('hidden');

  // If Luna prompted this, or if user clicked the button manually
  if (lunaMessage) {
    addBubble('luna', lunaMessage);
  } else if (state.screen === 'chat') {
    addBubbleReveal('luna', 'Opening Wallpaper Manager...');
  }
}

function closeWallpaperPicker() {
  $('wallpaperModal').classList.add('hidden');
}

// Wallpaper Toolbar Buttons
if ($('wallpaperBtn')) $('wallpaperBtn').onclick = () => openWallpaperPicker();
if ($('voiceWallpaperBtn')) $('voiceWallpaperBtn').onclick = () => openWallpaperPicker();

// Wallpaper Picker Events
if ($('closeWallpaper'))  $('closeWallpaper').onclick  = closeWallpaperPicker;
if ($('closeWallpaper2')) $('closeWallpaper2').onclick = closeWallpaperPicker;
if ($('wpResetBtn')) $('wpResetBtn').onclick = () => {
  applyWallpaper('default');
  closeWallpaperPicker();
  if (state.screen === 'chat') addBubble('system', 'Wallpaper reset to default.');
};
if ($('wpApplyBtn')) $('wpApplyBtn').onclick = () => {
  if (!wpSelectedValue) { closeWallpaperPicker(); return; }
  if (wpSelectedValue.startsWith('__storage__:')) {
    const fname = wpSelectedValue.replace('__storage__:', '');
    applyWallpaper(fname);
  } else {
    applyWallpaper(wpSelectedValue);
  }
  closeWallpaperPicker();
  if (state.screen === 'chat') addBubble('system', '✅ Wallpaper applied!');
};

// Handle dynamic wallpaper uploads from picker
if ($('wpUploadInput')) $('wpUploadInput').onchange = e => {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    const name = `wallpaper_${Date.now()}_${file.name}`;
    storageData.push({ name: name, content: dataUrl });
    localStorage.setItem('luna_storage', JSON.stringify(storageData));
    updateStorageUI();
    // Re-open picker to show new image (effectively refreshes the list)
    openWallpaperPicker();
    // Auto-select the new one
    setTimeout(() => {
        const selector = `[data-value="__storage__:${name}"]`;
        const thumb = document.querySelector(selector);
        if (thumb) thumb.click();
    }, 100);
  };
  reader.readAsDataURL(file);
};

// Expose so Luna can call it via command
window.openWallpaperPicker = openWallpaperPicker;

// Helper: setPyStatus (referenced in IDE section)
function setPyStatus(status) {
  const el = $('pyStatus');
  if (!el) return;
  if (status === 'ready') {
    el.textContent = '🐍 Python Ready';
    el.style.background = 'rgba(0,255,100,0.1)';
    el.style.color = '#00ff88';
    el.style.borderColor = 'rgba(0,255,100,0.3)';
  } else if (status === 'loading') {
    el.textContent = '🐍 Loading...';
    el.style.background = 'rgba(255,165,0,0.15)';
    el.style.color = 'orange';
    el.style.borderColor = 'rgba(255,165,0,0.4)';
  } else {
    el.textContent = '🐍 ' + status;
  }
}

// Initialize UI
updateStorageUI();
