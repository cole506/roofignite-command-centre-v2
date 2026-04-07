// ═══════════════════════════════════════════════
// GAMBLE MODE — CS2 CASE OPENING FOCUS TOOL
// ═══════════════════════════════════════════════

let dtSpinLocked = localStorage.getItem('dt_spin_locked') === 'true';
let dtCurrentAccount = localStorage.getItem('dt_current_account') || null;

function renderDontTouch() {
  const el = document.getElementById('view-donttouch');
  if (!el) return;
  el.classList.remove('hidden');

  var managers = getManagers();
  var savedDtManager = localStorage.getItem('dt_manager') || managers[0] || '';
  // Get all accounts for this manager (any status)
  var allMgrAccts = allAccounts
    .filter(function(a) { return a.manager === savedDtManager; })
    .map(function(a) { return a.name; })
    .filter(function(v, i, arr) { return arr.indexOf(v) === i; });
  // Remove accounts completed today
  var todayDate = new Date().toISOString().slice(0, 10);
  var todayKey = 'dt_done_' + todayDate;
  var doneToday = [];
  try { doneToday = JSON.parse(localStorage.getItem(todayKey) || '[]'); } catch(e) {}
  var activeAccts = allMgrAccts.filter(function(n) { return doneToday.indexOf(n) === -1; });
  var breaksToday = parseInt(localStorage.getItem('dt_breaks_' + todayDate) || '0', 10);

  var html = '<div class="max-w-4xl mx-auto py-8">';
  html += '<div class="text-center mb-8">';
  html += '<h1 class="text-3xl font-black text-white mb-2">GAMBLE MODE</h1>';
  html += '<p class="text-dark-400 text-sm mb-4">Spin the wheel. Work the account. No switching.</p>';
  html += '<select id="dt-manager-select" onchange="localStorage.setItem(\'dt_manager\',this.value);renderDontTouch()" class="text-sm bg-dark-700 border border-dark-600 text-dark-200 rounded-lg px-4 py-2 appearance-none cursor-pointer">';
  managers.forEach(function(m) {
    html += '<option value="' + m + '"' + (m === savedDtManager ? ' selected' : '') + '>' + m + '</option>';
  });
  html += '</select>';
  if (allMgrAccts.length) {
    html += '<div class="text-dark-500 text-xs mt-3">' + doneToday.length + ' / ' + allMgrAccts.length + ' accounts completed today' + (activeAccts.length === 0 ? ' — all done!' : '') + '</div>';
  }
  html += '</div>';

  // Restore locked state if we had an in-progress account
  if (dtSpinLocked && dtCurrentAccount) {
    var isBreak = dtCurrentAccount === '15 MIN BREAK';
    html += '<div class="glass rounded-2xl p-8 text-center mb-6">';
    if (isBreak) {
      html += '<div class="text-yellow-400 text-xs uppercase tracking-widest font-bold mb-3">&#127881; GOLD &#127881;</div>';
      html += '<div class="text-4xl font-black text-yellow-300 mb-2">15 Minute Break!</div>';
      html += '<div class="text-dark-400 text-sm">You earned it. Step away, grab coffee, touch grass.</div>';
    } else {
      var acctObj = allAccounts.find(function(a) { return a.name === dtCurrentAccount; });
      var acctLink = 'account.html?name=' + encodeURIComponent(dtCurrentAccount) + '&adAccountId=' + encodeURIComponent((acctObj && acctObj.adAccountId) || '');
      html += '<div class="text-orange-400 text-xs uppercase tracking-widest font-bold mb-3">YOUR MISSION</div>';
      html += '<div class="text-4xl font-black text-white mb-2">' + dtCurrentAccount + '</div>';
      html += '<div class="text-dark-400 text-sm mb-5">Focus on this account. Click "I\'m Done" when you\'re finished.</div>';
      html += '<a href="' + acctLink + '" class="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-brand-500/20 border border-brand-500/30 text-brand-400 hover:bg-brand-500/30 transition-all">';
      html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>';
      html += 'Go to Account</a>';
    }
    html += '</div>';
    html += '<div class="text-center mb-8">';
    html += '<button onclick="dtFinish()" class="px-8 py-3 rounded-2xl text-sm font-bold bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg shadow-green-500/30 uppercase tracking-wider">I\'M DONE — SPIN AGAIN</button>';
    html += '</div>';
  } else if (!activeAccts.length) {
    html += '<div class="text-center py-12 text-dark-400">No accounts for ' + savedDtManager + '</div>';
  } else {
    // Case opening strip
    html += '<div class="glass rounded-2xl p-6 mb-6 overflow-hidden">';
    html += '<div class="relative" style="height:120px;">';
    html += '<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:20;width:3px;height:120px;background:linear-gradient(to bottom,#f97316,#f97316 85%,transparent);"></div>';
    html += '<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);z-index:21;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid #f97316;"></div>';
    html += '<div id="dt-strip" style="display:flex;position:absolute;top:0;left:0;height:120px;transition:none;will-change:transform;"></div>';
    html += '</div></div>';
    // Spin button
    html += '<div class="text-center mb-8" id="dt-spin-area">';
    html += '<button onclick="dtSpin()" id="dt-spin-btn" class="px-10 py-4 rounded-2xl text-lg font-black bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600 transition-all shadow-lg shadow-orange-500/30 uppercase tracking-wider">SPIN THE WHEEL</button>';
    html += '</div>';
    // Result area
    html += '<div id="dt-result" class="hidden">';
    html += '<div id="dt-result-header" class="glass rounded-2xl p-8 text-center"></div>';
    html += '<div class="text-center mt-6" id="dt-done-area" style="display:none;">';
    html += '<button onclick="dtFinish()" class="px-8 py-3 rounded-2xl text-sm font-bold bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg shadow-green-500/30 uppercase tracking-wider">I\'M DONE — SPIN AGAIN</button>';
    html += '</div></div>';
  }
  html += '</div>';
  el.innerHTML = html;

  if (activeAccts.length) dtBuildStrip(activeAccts, breaksToday);
}

function dtBuildStrip(accounts, breaksUsed) {
  const strip = document.getElementById('dt-strip');
  if (!strip || !accounts.length) return;
  const CARD_W = 212;
  // Build the pool: all accounts + remaining break cards (max 2 per day)
  const BREAK_LABEL = '15 MIN BREAK';
  var pool = accounts.slice();
  var breaksRemaining = Math.max(0, 2 - (breaksUsed || 0));
  for (var b = 0; b < breaksRemaining; b++) {
    pool.push(BREAK_LABEL);
  }
  // Shuffle the pool for each repeat
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  var repeats = Math.max(8, Math.ceil(1500 / (pool.length * CARD_W)));
  var html = '';
  var colors = ['from-blue-500/20 to-blue-600/20 border-blue-500/30', 'from-purple-500/20 to-purple-600/20 border-purple-500/30', 'from-teal-500/20 to-teal-600/20 border-teal-500/30', 'from-pink-500/20 to-pink-600/20 border-pink-500/30', 'from-amber-500/20 to-amber-600/20 border-amber-500/30', 'from-indigo-500/20 to-indigo-600/20 border-indigo-500/30'];
  var goldStyle = 'from-yellow-400/30 to-amber-500/30 border-yellow-500/50';
  var allCards = []; // track names in order
  for (var r = 0; r < repeats; r++) {
    var shuffled = shuffle(pool);
    shuffled.forEach(function(name, i) {
      var isBreak = (name === BREAK_LABEL);
      var color = isBreak ? goldStyle : colors[i % colors.length];
      var textClass = isBreak ? 'text-yellow-300' : 'text-white';
      var icon = isBreak ? '<div class="text-2xl mb-1">&#9749;</div>' : '';
      html += '<div class="flex-shrink-0 w-[200px] h-[120px] rounded-xl bg-gradient-to-br ' + color + ' border flex flex-col items-center justify-center mx-1.5" data-account="' + name.replace(/"/g,'&quot;') + '">';
      html += icon + '<span class="' + textClass + ' font-bold text-sm text-center px-3 leading-tight">' + name + '</span>';
      html += '</div>';
      allCards.push(name);
    });
  }
  strip.innerHTML = html;
  strip._accounts = pool; // includes breaks
  strip._accountNames = allCards; // flat ordered list
  strip._cardW = CARD_W;
  strip._totalCards = allCards.length;
}

function dtSpin() {
  if (dtSpinLocked) {
    showToast('Finish your current account first!', 'error');
    return;
  }
  const strip = document.getElementById('dt-strip');
  const btn = document.getElementById('dt-spin-btn');
  const result = document.getElementById('dt-result');
  if (!strip || !strip._accounts) return;

  const allCards = strip._accountNames;
  const CARD_W = strip._cardW;
  const containerWidth = strip.parentElement.offsetWidth;
  const totalCards = allCards.length;

  // Pick a random card from the middle section (avoid edges)
  const safeStart = Math.floor(totalCards * 0.4);
  const safeEnd = Math.floor(totalCards * 0.7);
  const targetCardIndex = safeStart + Math.floor(Math.random() * (safeEnd - safeStart));
  const winnerName = allCards[targetCardIndex];

  // Measure actual card positions from the DOM for accuracy
  const cards = strip.children;
  let targetOffset;
  if (cards[targetCardIndex]) {
    const cardLeft = cards[targetCardIndex].offsetLeft;
    const cardW = cards[targetCardIndex].offsetWidth;
    targetOffset = cardLeft + (cardW / 2) - (containerWidth / 2);
  } else {
    // Fallback: calculate from CARD_W
    targetOffset = (targetCardIndex * CARD_W) + (CARD_W / 2) - (containerWidth / 2);
  }

  // Disable button
  btn.disabled = true;
  btn.classList.add('opacity-50');
  result.classList.add('hidden');

  // Reset position
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';

  // Force reflow then animate
  void strip.offsetWidth;
  // CS2-style easing: fast start, very slow end
  strip.style.transition = 'transform 6s cubic-bezier(0.15, 0.85, 0.2, 1)';
  strip.style.transform = `translateX(-${targetOffset}px)`;

  // Audio context for tick sounds
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  function playTick(freq, vol) {
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq || 800;
    osc.type = 'square';
    gain.gain.value = vol || 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06);
  }
  function playWinSound() {
    [0, 100, 200, 350].forEach(function(delay, i) {
      setTimeout(function() {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = [523, 659, 784, 1047][i];
        osc.type = 'sine';
        gain.gain.value = 0.12;
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      }, delay);
    });
  }

  // Fast ticks with sound
  let tickInterval = setInterval(() => {
    playTick(800 + Math.random() * 400, 0.06);
    strip.parentElement.style.boxShadow = '0 0 20px rgba(249,115,22,0.3)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 50);
  }, 80);

  // Slow down ticks
  setTimeout(() => { clearInterval(tickInterval); tickInterval = setInterval(() => {
    playTick(600 + Math.random() * 200, 0.1);
    strip.parentElement.style.boxShadow = '0 0 30px rgba(249,115,22,0.4)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 100);
  }, 200); }, 3000);

  // Even slower near the end
  setTimeout(() => { clearInterval(tickInterval); tickInterval = setInterval(() => {
    playTick(500, 0.12);
    strip.parentElement.style.boxShadow = '0 0 35px rgba(249,115,22,0.5)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 150);
  }, 400); }, 5000);

  // When done
  setTimeout(() => {
    clearInterval(tickInterval);
    playWinSound();
    strip.parentElement.style.boxShadow = '0 0 40px rgba(249,115,22,0.6)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 500);

    dtSpinLocked = true;
    dtCurrentAccount = winnerName;
    localStorage.setItem('dt_spin_locked', 'true');
    localStorage.setItem('dt_current_account', winnerName);

    // Show result
    var isBreak = winnerName === '15 MIN BREAK';
    result.classList.remove('hidden');
    if (isBreak) {
      document.getElementById('dt-result-header').innerHTML =
        '<div class="text-yellow-400 text-xs uppercase tracking-widest font-bold mb-3">&#127881; GOLD &#127881;</div>' +
        '<div class="text-4xl font-black text-yellow-300 mb-2">15 Minute Break!</div>' +
        '<div class="text-dark-400 text-sm">You earned it. Step away, grab coffee, touch grass.</div>';
    } else {
      var acctObj = allAccounts.find(function(a) { return a.name === winnerName; });
      var acctLink = 'account.html?name=' + encodeURIComponent(winnerName) + '&adAccountId=' + encodeURIComponent((acctObj && acctObj.adAccountId) || '');
      document.getElementById('dt-result-header').innerHTML =
        '<div class="text-orange-400 text-xs uppercase tracking-widest font-bold mb-3">YOUR MISSION</div>' +
        '<div class="text-4xl font-black text-white mb-2">' + winnerName + '</div>' +
        '<div class="text-dark-400 text-sm mb-5">Focus on this account. Click "I\'m Done" when you\'re finished.</div>' +
        '<a href="' + acctLink + '" class="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-brand-500/20 border border-brand-500/30 text-brand-400 hover:bg-brand-500/30 transition-all">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>' +
        'Go to Account</a>';
    }
    document.getElementById('dt-done-area').style.display = 'block';

    btn.textContent = 'LOCKED — FINISH YOUR ACCOUNT';
    btn.onclick = function() { showToast('Finish your current account first!', 'error'); };
    btn.disabled = false;
    btn.classList.remove('opacity-50');
  }, 6500);
}

function dtFinish() {
  // Save completed account for today
  if (dtCurrentAccount) {
    var todayDate = new Date().toISOString().slice(0, 10);
    var todayKey = 'dt_done_' + todayDate;
    if (dtCurrentAccount === '15 MIN BREAK') {
      // Track break count separately (allows up to 2 per day)
      var breakKey = 'dt_breaks_' + todayDate;
      var breaks = parseInt(localStorage.getItem(breakKey) || '0', 10);
      localStorage.setItem(breakKey, breaks + 1);
    } else {
      var doneToday = [];
      try { doneToday = JSON.parse(localStorage.getItem(todayKey) || '[]'); } catch(e) {}
      if (doneToday.indexOf(dtCurrentAccount) === -1) doneToday.push(dtCurrentAccount);
      localStorage.setItem(todayKey, JSON.stringify(doneToday));
    }
  }
  dtSpinLocked = false;
  dtCurrentAccount = null;
  localStorage.removeItem('dt_spin_locked');
  localStorage.removeItem('dt_current_account');
  // Re-render to rebuild strip without completed accounts
  renderDontTouch();
}
