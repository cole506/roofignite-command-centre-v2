// ═══════════════════════════════════════════════
// RENDER: BILLING TRACKER
// ═══════════════════════════════════════════════
// ═══ Billing Actions ═══

async function setBillingStatus(accountName, cycleName, field, value) {
  // field is 'goodToBill' or 'billed', value is the new state
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const oldGTB = (c.goodToBill || '').trim().toLowerCase();
  const oldBilled = (c.billed || '').trim().toLowerCase();

  c[field] = value;

  // Re-render billing view
  renderBilling();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('updateBilling', {
      name: accountName, cycle: cycleName,
      goodToBill: c.goodToBill || '', billed: c.billed || '', billingNotes: c.billingNotes || '',
      notifySlack: true,
      oldGoodToBill: oldGTB, oldBilled: oldBilled,
      manager: c.manager || acct.manager || '',
      billingAdmin: localStorage.getItem('roofignite_billing_admin') || (CONFIG.SLACK && CONFIG.SLACK.DEFAULT_BILLING_ADMIN) || '',
    });
    if (result.ok) {
      showToast(`${accountName} — ${field}: ${value || 'cleared'} ✓`, 'success');
    } else {
      showToast(`⚠️ Updated locally but Sheet sync failed`, 'error');
    }
  } else {
    showToast(`${field} updated (local only — connect GAS to sync + notify)`, 'success');
  }
}

// Legacy toggle wrapper
async function toggleBillingField(accountName, cycleName, field) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;
  const current = (c[field] || '').trim().toLowerCase();
  setBillingStatus(accountName, cycleName, field, current === 'yes' ? '' : 'Yes');
}

var _billingNotesTimeout = null;
var _billingNotesPendingSave = null; // stored so navigate() can flush it
async function updateBillingNotes(accountName, cycleName, notes) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  c.billingNotes = notes;

  // Build the save function so it can be flushed by navigate()
  const doSave = async () => {
    _billingNotesPendingSave = null;
    if (APPS_SCRIPT_URL) {
      const result = await writeToSheet('updateBilling', {
        name: accountName, cycle: cycleName,
        goodToBill: c.goodToBill || '', billed: c.billed || '', billingNotes: c.billingNotes || ''
      });
      if (result.ok) {
        showToast(`Billing notes saved ✓`, 'success');
      } else {
        showToast(`⚠️ Notes saved locally but failed to save to Sheet`, 'error');
      }
    }
  };

  // Debounce save — wait 800ms after last keystroke
  if (_billingNotesTimeout) clearTimeout(_billingNotesTimeout);
  _billingNotesPendingSave = doSave;
  _billingNotesTimeout = setTimeout(doSave, 800);
}

// Parse retainer info from billingNotes prefix: {"rb":4000,"rp":10}|notes
function parseRetainerFromNotes(notesStr) {
  if (!notesStr) return { retainerBase: null, retainerPercent: null, notes: '' };
  const match = notesStr.match(/^\{[^}]+\}\|/);
  if (match) {
    try {
      const json = JSON.parse(match[0].slice(0, -1));
      return {
        retainerBase: json.rb || null,
        retainerPercent: json.rp != null ? json.rp : null,
        notes: notesStr.slice(match[0].length)
      };
    } catch(e) { /* fall through */ }
  }
  return { retainerBase: null, retainerPercent: null, notes: notesStr };
}

// Encode retainer info into billingNotes prefix
function encodeRetainerInNotes(retainerBase, retainerPercent, humanNotes) {
  const prefix = (retainerBase != null || retainerPercent != null)
    ? JSON.stringify({ rb: retainerBase || 0, rp: retainerPercent || 0 }) + '|'
    : '';
  return prefix + (humanNotes || '');
}

// Update billing notes preserving retainer JSON prefix
async function updateBillingNotesWithRetainer(accountName, cycleName, newHumanNotes) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const existing = parseRetainerFromNotes(c.billingNotes);
  c.billingNotes = encodeRetainerInNotes(existing.retainerBase, existing.retainerPercent, newHumanNotes);

  if (_billingNotesTimeout) clearTimeout(_billingNotesTimeout);
  _billingNotesTimeout = setTimeout(async () => {
    if (APPS_SCRIPT_URL) {
      const result = await writeToSheet('updateBilling', {
        name: accountName, cycle: cycleName,
        goodToBill: c.goodToBill || '', billed: c.billed || '', billingNotes: c.billingNotes || ''
      });
      if (result.ok) {
        showToast('Billing notes saved', 'success');
      } else {
        showToast('Notes saved locally but failed to save to Sheet', 'error');
      }
    }
  }, 800);
}

// ═══ Invoice Modal ═══

function showInvoiceModal(accountName, cycleName, adSpend) {
  const adSpendVal = adSpend || 0;
  const intervals = (CONFIG.SLACK && CONFIG.SLACK.PERCENTAGE_INTERVALS) || [0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100];

  const acct = allAccounts.find(a => a.name === accountName);
  const cyc = acct ? acct.cycles.find(c => c.cycle === cycleName) : null;
  const existing = cyc ? parseRetainerFromNotes(cyc.billingNotes) : { retainerBase: null, retainerPercent: null, notes: '' };

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-md w-full border border-yellow-500/30 modal-inner" data-adspend="${adSpendVal}" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/>
          </svg>
        </div>
        <div>
          <h3 class="text-white font-bold text-lg">Invoice</h3>
          <p class="text-dark-400 text-xs">${accountName} · ${cycleName}</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="text-white text-lg font-bold w-6 text-right">$</span>
          <input id="inv-base" type="number" step="1" min="0" placeholder="Base retainer" value="${existing.retainerBase || ''}"
            class="flex-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-yellow-500"
            oninput="updateInvoiceTotal()" />
        </div>

        <div class="flex items-center gap-3">
          <span class="text-dark-400 text-lg font-bold w-6 text-right">+</span>
          <select id="inv-pct" onchange="updateInvoiceTotal()"
            class="bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2.5 focus:outline-none focus:border-yellow-500 min-w-[90px]">
            ${intervals.map(p => '<option value="' + p + '"' + (existing.retainerPercent === p ? ' selected' : '') + '>' + p + '%</option>').join('')}
          </select>
          <span id="inv-pct-calc" class="text-dark-400 text-xs">+ ${fmtDollar(0)} (${0}% of ${fmtDollar(adSpendVal)} ad spend)</span>
        </div>

        <div class="flex items-center gap-3 pt-2 border-t border-dark-600/30">
          <span class="text-white text-lg font-bold w-6 text-right">=</span>
          <span id="inv-total" class="text-white text-lg font-extrabold">${fmtDollar(0)} total</span>
        </div>

        <div class="pt-3">
          <label class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1 block">Notes</label>
          <textarea id="inv-notes" rows="2" placeholder="Optional billing notes…"
            class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-yellow-500 resize-none">${existing.notes || ''}</textarea>
        </div>
      </div>

      <div class="flex justify-end gap-3 mt-6">
        <button onclick="this.closest('.fixed').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="submitInvoice('${esc(accountName)}','${esc(cycleName)}',${adSpendVal})" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 shadow-lg shadow-yellow-500/20 transition-all">Send</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => {
    updateInvoiceTotal();
    const el = document.getElementById('inv-base');
    if (el) el.focus();
  }, 50);
}

function updateInvoiceTotal() {
  const base = parseFloat(document.getElementById('inv-base')?.value) || 0;
  const pct = parseInt(document.getElementById('inv-pct')?.value) || 0;
  const adSpend = parseFloat(document.querySelector('[data-adspend]')?.dataset.adspend) || 0;
  const pctAmount = Math.round(adSpend * pct / 100);
  const total = base + pctAmount;

  const calcLabel = document.getElementById('inv-pct-calc');
  if (calcLabel) calcLabel.textContent = '+ ' + fmtDollar(pctAmount) + ' (' + pct + '% of ' + fmtDollar(adSpend) + ' ad spend)';
  const totalEl = document.getElementById('inv-total');
  if (totalEl) totalEl.textContent = fmtDollar(total) + ' total';
}

async function submitInvoice(accountName, cycleName, adSpend) {
  const base = parseFloat(document.getElementById('inv-base')?.value) || 0;
  const pct = parseInt(document.getElementById('inv-pct')?.value) || 0;
  const modalNotes = (document.getElementById('inv-notes')?.value || '').trim();

  // Close modal
  const modal = document.querySelector('.fixed.inset-0.z-\\[200\\]');
  if (modal) modal.remove();

  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const oldGTB = (c.goodToBill || '').trim().toLowerCase();
  const oldBilled = (c.billed || '').trim().toLowerCase();

  c.goodToBill = 'Yes';

  // Encode retainer info + notes from modal into billingNotes
  c.billingNotes = encodeRetainerInNotes(base, pct, modalNotes);

  renderBilling();

  if (APPS_SCRIPT_URL) {
    const pctAmount = Math.round((adSpend || 0) * pct / 100);
    const total = base + pctAmount;
    const result = await writeToSheet('updateBilling', {
      name: accountName, cycle: cycleName,
      goodToBill: c.goodToBill || '', billed: c.billed || '', billingNotes: c.billingNotes || '',
      notifySlack: true,
      oldGoodToBill: oldGTB, oldBilled: oldBilled,
      manager: c.manager || acct.manager || '',
      billingAdmin: localStorage.getItem('roofignite_billing_admin') || (CONFIG.SLACK && CONFIG.SLACK.DEFAULT_BILLING_ADMIN) || '',
      retainerBase: base,
      retainerPercent: pct,
      adSpend: adSpend || 0,
      invoiceTotal: total,
    });
    if (result.ok) {
      showToast(`${accountName} — Good to Bill: ${fmtDollar(total)} ✓`, 'success');
    } else {
      showToast('Updated locally but Sheet sync failed', 'error');
    }
  } else {
    showToast('Good to Bill updated (local only)', 'success');
  }
}

let billingViewFilter = 'action'; // 'action' or 'all'

let _billingSectionId = 0;
function renderBilling() {
  const el = document.getElementById('view-billing');
  el.classList.remove('hidden');

  const today = getTodayStr();
  const todayMs = new Date(today).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  // Gather billing data from ALL cycles across ALL accounts
  const billingData = [];
  allAccounts.forEach(a => {
    const cycles = a.cycles || [];
    if (!cycles.length) return;

    cycles.forEach((c, ci) => {
      const endMs = c.cycleEndDate ? new Date(c.cycleEndDate).getTime() : null;
      const daysUntilEnd = endMs ? Math.ceil((endMs - todayMs) / dayMs) : null;
      const daysSinceEnd = endMs ? Math.ceil((todayMs - endMs) / dayMs) : null;
      const cycleEnded = daysUntilEnd !== null && daysUntilEnd < 0;
      const gtb = (c.goodToBill || '').trim().toLowerCase();
      const bld = (c.billed || '').trim().toLowerCase();
      const isBilled = bld === 'yes';
      const isGoodToBill = gtb === 'yes';
      const isFailed = bld === 'failed' || bld === 'failed payment';
      const isLost = bld === 'lost';
      const isRetryBilled = bld === 'try again';
      const isRetryGTB = gtb === 'try again';

      // Categorize
      let category = 'active'; // default for mid-cycle
      if (isLost) {
        category = 'lost';
      } else if (isBilled) {
        category = 'billed';
      } else if (isFailed) {
        category = 'failed';
      } else if (isRetryBilled || isRetryGTB) {
        category = 'retry';
      } else if (isGoodToBill && !isBilled) {
        category = 'readyToBill';
      } else if (cycleEnded && daysSinceEnd > 7) {
        category = 'overdue';
      } else if (cycleEnded && daysSinceEnd <= 7) {
        category = 'late';
      } else if (!cycleEnded && daysUntilEnd !== null && daysUntilEnd <= 7 && daysUntilEnd >= 0) {
        category = 'upcoming';
      }

      billingData.push({
        account: a, cycleObj: c, cycleIndex: ci,
        cycle: c.cycle, cycleEndDate: c.cycleEndDate,
        spent: c.amountSpent,
        goodToBill: c.goodToBill || '',
        billed: c.billed || '',
        billingNotes: c.billingNotes || '',
        monthlyBudget: c.monthlyBudget || a.monthlyBudget,
        manager: c.manager || a.manager,
        daysUntilEnd, daysSinceEnd, cycleEnded,
        isGoodToBill, isBilled, isFailed, isLost, isRetryBilled, isRetryGTB, category,
        isPaused: a.isPaused,
      });
    });
  });

  // Split into categories
  const lost       = billingData.filter(b => b.category === 'lost');
  const failed     = billingData.filter(b => b.category === 'failed');
  const retry      = billingData.filter(b => b.category === 'retry');
  const overdue    = billingData.filter(b => b.category === 'overdue').sort((a,b) => b.daysSinceEnd - a.daysSinceEnd);
  const late       = billingData.filter(b => b.category === 'late').sort((a,b) => b.daysSinceEnd - a.daysSinceEnd);
  const readyToBill = billingData.filter(b => b.category === 'readyToBill');
  const upcoming   = billingData.filter(b => b.category === 'upcoming').sort((a,b) => a.daysUntilEnd - b.daysUntilEnd);
  const active     = billingData.filter(b => b.category === 'active').sort((a,b) => (a.daysUntilEnd||999) - (b.daysUntilEnd||999));
  const billedDone = billingData.filter(b => b.category === 'billed');

  const needsAction = [...failed, ...retry, ...overdue, ...late, ...readyToBill, ...upcoming];
  const totalNeedsAction = needsAction.reduce((s,b) => s + getInvoiceTotal(b), 0);
  const totalBilled   = billedDone.reduce((s,b) => s + getInvoiceTotal(b), 0);

  function timingLabel(b) {
    if (b.daysUntilEnd === 0) return 'Ends today';
    if (b.daysUntilEnd === 1) return 'Ends tomorrow';
    if (b.daysUntilEnd > 0) return b.daysUntilEnd + 'd left';
    if (b.daysSinceEnd === 0) return 'Ended today';
    if (b.daysSinceEnd !== null && b.daysSinceEnd > 0) return b.daysSinceEnd + 'd overdue';
    return '';
  }

  function formatRetainerDisplay(b) {
    const parsed = parseRetainerFromNotes(b.billingNotes);
    if (parsed.retainerBase == null && parsed.retainerPercent == null) return '<span class="text-dark-500">—</span>';
    let display = fmtDollar(parsed.retainerBase);
    if (parsed.retainerPercent > 0) {
      display += ' <span class="text-dark-400">+ ' + parsed.retainerPercent + '%</span>';
    }
    return display;
  }

  function getInvoiceTotal(b) {
    const parsed = parseRetainerFromNotes(b.billingNotes);
    if (parsed.retainerBase == null) return 0;
    const pctAmount = parsed.retainerPercent ? Math.round((b.spent || 0) * parsed.retainerPercent / 100) : 0;
    return (parsed.retainerBase || 0) + pctAmount;
  }

  function statusBadge(b) {
    if (b.isBilled) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">✓ Billed</span>';
    if (b.isLost) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-dark-600/30 text-dark-400 border border-dark-500/25">☠ Lost</span>';
    if (b.isFailed) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/25">✗ Failed</span>';
    if (b.isRetryBilled || b.isRetryGTB) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/15 text-orange-400 border border-orange-500/25">↻ Retry</span>';
    if (b.isGoodToBill) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">$ Ready</span>';
    if (b.category === 'overdue') return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">' + timingLabel(b) + '</span>';
    if (b.category === 'late') return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">' + timingLabel(b) + '</span>';
    if (b.category === 'upcoming') return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">' + timingLabel(b) + '</span>';
    if (b.daysUntilEnd !== null && b.daysUntilEnd > 0) return '<span class="text-dark-500 text-[10px]">' + b.daysUntilEnd + 'd left</span>';
    return '<span class="text-dark-500 text-[10px]">—</span>';
  }

  function actionButtons(b) {
    const an = esc(b.account.name);
    const cn = esc(b.cycle);
    const gtb = b.goodToBill.trim().toLowerCase();
    const bld = b.billed.trim().toLowerCase();

    // Already billed — show reset option
    if (b.isBilled) {
      return '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'\')" class="px-2 py-1 rounded-md text-[10px] font-semibold bg-dark-700 text-dark-400 border border-dark-600 hover:border-dark-400 transition-all" title="Undo billed">Undo</button>';
    }

    // Lost — show undo only
    if (b.isLost) {
      return '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'\')" class="px-2 py-1 rounded-md text-[10px] font-semibold bg-dark-700 text-dark-400 border border-dark-600 hover:border-dark-400 transition-all" title="Undo lost">Undo</button>';
    }

    let btns = '';
    // Good to Bill toggle
    if (!b.isGoodToBill) {
      btns += '<button onclick="event.stopPropagation();showInvoiceModal(\''+an+'\',\''+cn+'\',' + (b.spent || 0) + ')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/25 hover:bg-yellow-500/20 transition-all" title="Create invoice → notifies billing admin">Good to Bill</button>';
    } else {
      btns += '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'goodToBill\',\'\')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 transition-all" title="Undo Good to Bill">GTB ✓</button>';
    }

    // Billed / Failed / Try Again
    btns += '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'Yes\')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all" title="Mark Billed → notifies account manager">Billed ✓</button>';
    btns += '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'Failed\')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 transition-all" title="Payment Failed → notifies account manager">Failed</button>';
    btns += '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'Lost\')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-dark-600/50 text-dark-400 border border-dark-500/25 hover:bg-dark-500/30 transition-all" title="Write off as lost">Lost</button>';

    // Try Again
    if (b.isFailed || bld === 'failed' || bld === 'failed payment') {
      btns += '<button onclick="event.stopPropagation();setBillingStatus(\''+an+'\',\''+cn+'\',\'billed\',\'Try Again\')" class="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/25 hover:bg-orange-500/20 transition-all" title="Retry charge → notifies Oscar">Try Again</button>';
    }

    return '<div class="flex items-center gap-1 flex-wrap">' + btns + '</div>';
  }

  function billingRow(b) {
    return '<tr class="border-b border-dark-700/50 hover:bg-dark-700/20 transition-colors' + (b.isPaused ? ' opacity-50' : '') + '">' +
      '<td class="py-3 px-4 text-white font-medium cursor-pointer" onclick="navigate(\'account\',{name:\''+esc(b.account.name)+'\',adAccountId:\''+esc(b.account.adAccountId||'')+'\'})">' +
        b.account.name + (b.isPaused ? ' <span class="text-dark-500 text-[9px]">(paused)</span>' : '') +
        '<div class="text-[10px] text-dark-500">' + (b.manager||'') + ' · ' + (b.account.pod||'').replace(' - RoofIgnite','') + '</div>' +
      '</td>' +
      '<td class="py-3 px-4 text-dark-300 text-xs">' + b.cycle + '</td>' +
      '<td class="py-3 px-4 text-dark-300 text-xs">' + (b.cycleEndDate||'—') + '</td>' +
      '<td class="py-3 px-4 text-right text-white text-xs mobile-hide">' + formatRetainerDisplay(b) + '</td>' +
      '<td class="py-3 px-4">' + statusBadge(b) + '</td>' +
      '<td class="py-3 px-4 mobile-hide">' + actionButtons(b) + '</td>' +
      '<td class="py-3 px-4 mobile-hide">' +
        '<input type="text" value="' + (parseRetainerFromNotes(b.billingNotes).notes||'').replace(/"/g,'&quot;') + '" placeholder="Notes..."' +
          ' class="w-full bg-dark-700/50 border border-dark-600/30 rounded px-2 py-1 text-xs text-dark-200 focus:outline-none focus:border-brand-500/50"' +
          ' onchange="updateBillingNotesWithRetainer(\'' + esc(b.account.name) + '\',\'' + esc(b.cycle) + '\',this.value)" onclick="event.stopPropagation()" />' +
      '</td>' +
    '</tr>';
  }

  _billingSectionId = 0;
  function sectionTable(items) {
    const id = 'billing-section-' + (_billingSectionId++);
    const limit = 20;
    const hasMore = items.length > limit;
    const visibleRows = items.slice(0, limit).map(billingRow).join('');
    const hiddenRows = hasMore ? items.slice(limit).map(billingRow).join('') : '';
    return '<div class="overflow-x-auto table-scroll-hint"><table class="w-full text-sm min-w-[360px] md:min-w-0">' +
      '<thead><tr class="border-b border-dark-600 text-dark-400 text-[10px] uppercase tracking-wider">' +
        '<th class="py-2 px-4 text-left">Account</th><th class="py-2 px-4 text-left">Cycle</th>' +
        '<th class="py-2 px-4 text-left">Cycle End</th><th class="py-2 px-4 text-right mobile-hide">Retainer</th>' +
        '<th class="py-2 px-4 text-left">Status</th>' +
        '<th class="py-2 px-4 text-left mobile-hide">Actions</th><th class="py-2 px-4 text-left mobile-hide">Notes</th>' +
      '</tr></thead><tbody>' + visibleRows +
      (hasMore ? '<tr id="'+id+'-hidden" style="display:none"><td colspan="7"><table class="w-full text-sm"><tbody>' + hiddenRows + '</tbody></table></td></tr>' : '') +
      '</tbody></table></div>' +
      (hasMore ? '<div id="'+id+'-btn" class="p-3 text-center border-t border-dark-700/50"><button onclick="document.getElementById(\''+id+'-hidden\').style.display=\'\';document.getElementById(\''+id+'-btn\').style.display=\'none\';" class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-dark-700/50 text-dark-300 border border-dark-600/30 hover:text-white hover:border-dark-500 transition-all">Show ' + (items.length - limit) + ' more</button></div>' : '');
  }

  const showAll = billingViewFilter === 'all';

  el.innerHTML = `
    <div class="mb-5 md:mb-8 fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/15">
            <svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div>
            <h1 class="text-2xl font-extrabold text-white">Billing Center</h1>
            <p class="text-dark-300 text-sm mt-1">Manage billing status and trigger Slack notifications — replaces the spreadsheet automation</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="billingViewFilter='action';renderBilling()" class="px-4 py-2 rounded-xl text-xs font-semibold transition-all ${!showAll ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-dark-700/50 text-dark-400 border border-dark-600/30 hover:text-white'}">
            Needs Action (${needsAction.length})
          </button>
          <button onclick="billingViewFilter='all';renderBilling()" class="px-4 py-2 rounded-xl text-xs font-semibold transition-all ${showAll ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-dark-700/50 text-dark-400 border border-dark-600/30 hover:text-white'}">
            All Accounts (${billingData.length})
          </button>
        </div>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="grid grid-cols-7 gap-3 mb-5 md:mb-8 kpi-grid-7">
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-1" style="opacity:0;${failed.length ? 'border-color:rgba(239,68,68,0.3);' : ''}">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Failed</div>
        <div class="text-2xl font-extrabold text-red-400">${failed.length}</div>
        <div class="text-[10px] text-dark-500">need follow-up</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-2" style="opacity:0;${retry.length ? 'border-color:rgba(251,146,60,0.3);' : ''}">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Retry</div>
        <div class="text-2xl font-extrabold text-orange-400">${retry.length}</div>
        <div class="text-[10px] text-dark-500">re-charge needed</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-3" style="opacity:0;${overdue.length ? 'border-color:rgba(239,68,68,0.2);' : ''}">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Overdue</div>
        <div class="text-2xl font-extrabold text-red-400">${overdue.length}</div>
        <div class="text-[10px] text-dark-500">>7d past end</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-4" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Ready to Bill</div>
        <div class="text-2xl font-extrabold text-yellow-400">${readyToBill.length}</div>
        <div class="text-[10px] text-dark-500">charge in Stripe</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-5" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Upcoming</div>
        <div class="text-2xl font-extrabold text-blue-400">${upcoming.length + late.length}</div>
        <div class="text-[10px] text-dark-500">ending soon / just ended</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-5" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Billed ✓</div>
        <div class="text-2xl font-extrabold text-emerald-400">${billedDone.length}</div>
        <div class="text-[10px] text-dark-500">${fmtDollar(totalBilled)}</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card fade-in stagger-6" style="opacity:0;${lost.length ? 'border-color:rgba(100,116,139,0.3);' : ''}">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1">Lost</div>
        <div class="text-2xl font-extrabold text-dark-400">${lost.length}</div>
        <div class="text-[10px] text-dark-500">written off</div>
      </div>
    </div>

    ${showAll ? `
    <!-- ALL ACCOUNTS VIEW -->
    <div class="glass rounded-2xl overflow-hidden mb-4">
      <div class="p-4 border-b border-dark-600 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-brand-500"></span>
        <h3 class="text-white font-bold">All Cycles (${billingData.length})</h3>
      </div>
      ${sectionTable(billingData)}
    </div>
    ` : `
    <!-- NEEDS ACTION VIEW -->
    ${failed.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-red-500/25" style="background:linear-gradient(135deg,rgba(239,68,68,0.04),rgba(15,23,42,0.8));">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>' +
      '<h3 class="text-red-400 font-bold">Payment Failed (' + failed.length + ')</h3></div>' +
      sectionTable(failed) + '</div>' : ''}

    ${retry.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-orange-500/25" style="background:linear-gradient(135deg,rgba(251,146,60,0.04),rgba(15,23,42,0.8));">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>' +
      '<h3 class="text-orange-400 font-bold">Retry Needed (' + retry.length + ')</h3></div>' +
      sectionTable(retry) + '</div>' : ''}

    ${overdue.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-red-500/20" style="background:linear-gradient(135deg,rgba(239,68,68,0.03),rgba(15,23,42,0.8));">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-red-500"></span>' +
      '<h3 class="text-red-400 font-bold">Overdue — >7 Days Past Cycle End (' + overdue.length + ')</h3></div>' +
      sectionTable(overdue) + '</div>' : ''}

    ${late.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-orange-500/15" style="background:linear-gradient(135deg,rgba(251,146,60,0.03),rgba(15,23,42,0.8));">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-orange-500"></span>' +
      '<h3 class="text-orange-400 font-bold">Late — Ended ≤7 Days (' + late.length + ')</h3></div>' +
      sectionTable(late) + '</div>' : ''}

    ${readyToBill.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-yellow-500/15">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-yellow-500"></span>' +
      '<h3 class="text-yellow-400 font-bold">Ready to Bill — Charge in Stripe (' + readyToBill.length + ')</h3></div>' +
      sectionTable(readyToBill) + '</div>' : ''}

    ${upcoming.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-blue-500/15">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-blue-500"></span>' +
      '<h3 class="text-blue-400 font-bold">Upcoming — Ending Within 7 Days (' + upcoming.length + ')</h3></div>' +
      sectionTable(upcoming) + '</div>' : ''}

    ${billedDone.length ? '<div class="glass rounded-2xl overflow-hidden mb-4">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>' +
      '<h3 class="text-white font-bold">Billed & Complete (' + billedDone.length + ')</h3></div>' +
      sectionTable(billedDone) + '</div>' : ''}

    ${lost.length ? '<div class="glass rounded-2xl overflow-hidden mb-4 border border-dark-500/20" style="background:linear-gradient(135deg,rgba(100,116,139,0.04),rgba(15,23,42,0.8));">' +
      '<div class="p-4 border-b border-dark-600 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-dark-400"></span>' +
      '<h3 class="text-dark-400 font-bold">Lost — Written Off (' + lost.length + ')</h3></div>' +
      sectionTable(lost) + '</div>' : ''}

    ${!needsAction.length && !billedDone.length && !lost.length ? '<div class="glass rounded-xl p-8 text-center"><p class="text-dark-400">No billing-relevant cycles right now.</p></div>' : ''}
    `}
  `;
}

// ═══════════════════════════════════════════════
