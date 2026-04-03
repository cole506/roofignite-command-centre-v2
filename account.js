// ═══════════════════════════════════════════════
// RENDER: ACCOUNT DETAIL
// ═══════════════════════════════════════════════
function renderAccountDetail(name, adAccountId) {
  const el = document.getElementById('view-account');
  el.classList.remove('hidden');

  // Flexible match: try exact first, then name-only fallback
  let acct = allAccounts.find(a => a.name === name && a.adAccountId === adAccountId);
  if (!acct) acct = allAccounts.find(a => a.name === name);
  if (!acct) { el.innerHTML = '<p class="text-dark-400">Account not found</p>'; return; }

  const cycles = acct.cycles || [];
  // Try to find ad ID from any cycle row (most reliable source), then account header, then navigation param
  const cycleAdId = cycles.reduce((found, c) => found || c.adAccountId, '') || '';
  const adId = cycleAdId || acct.adAccountId || adAccountId || '';
  // Sync back so other functions use the right ID
  if (adId && !acct.adAccountId) acct.adAccountId = adId;
  // Also sync to all cycles that are missing it
  if (adId) cycles.forEach(c => { if (!c.adAccountId) c.adAccountId = adId; });
  const activeCyc = getActiveCycle(name, adId);
  const cpaGoal = acct.cpaGoal || (activeCyc && activeCyc.cpaGoal);
  const isActive = hasActiveCycle(acct);

  el.innerHTML = `
    <div class="mb-5 md:mb-8 fade-in">
      <div class="flex items-center justify-between gap-2">
        <button onclick="navigate(currentManager ? 'manager' : currentPod ? 'pod' : 'dashboard', currentManager || currentPod)" class="back-btn mb-4 flex-shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg> Back
        </button>
        <img src="data:image/png;base64,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" alt="RoofIgnite" class="h-8 w-auto opacity-40 mobile-hide" />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          ${(() => {
            const hs = getHealthScore(acct, activeCyc);
            const hsBadge = hs === null
              ? '<div class="w-14 h-14 rounded-2xl bg-dark-700/50 flex items-center justify-center text-dark-500 text-lg font-bold border border-dark-600">—</div>'
              : (() => { const hc = healthScoreColor(hs); return '<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-extrabold shadow-lg" style="background:'+hc.bg+';color:'+hc.text+';border:2px solid '+hc.text+'22;"><div class="text-center"><div class="text-lg font-extrabold leading-none">'+hs+'</div><div class="text-[8px] opacity-60 mt-0.5">HP</div></div></div>'; })();
            const fs = getFatigueScore(acct, activeCyc);
            const fsBadge = fs === null
              ? ''
              : (() => { const fc = fatigueScoreColor(fs); return '<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-extrabold shadow-lg" style="background:'+fc.bg+';color:'+fc.text+';border:2px solid '+fc.text+'22;"><div class="text-center"><div class="text-lg font-extrabold leading-none">'+fs+'</div><div class="text-[8px] opacity-60 mt-0.5">FTG</div></div></div>'; })();
            return hsBadge + fsBadge;
          })()}
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-extrabold text-white">${acct.name}</h1>
              ${isActive ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}
            </div>
            <p class="text-dark-300 text-sm mt-1">${acct.pod.replace(' - RoofIgnite','')} · Manager: ${acct.manager} · Ad Account: ${acct.adAccountId || 'N/A'}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <button onclick="openQuickEditModal('${esc(name)}','${esc(activeCyc.cycle)}',${JSON.stringify({cpaGoal:activeCyc.cpaGoal||'',bookedGoal:activeCyc.bookedGoal||'',dailyBudget:activeCyc.dailyBudget||'',monthlyBudget:activeCyc.monthlyBudget||'',cycleStartDate:activeCyc.cycleStartDate||'',cycleEndDate:activeCyc.cycleEndDate||''}).replace(/"/g,'&quot;')})" class="flex items-center gap-1.5 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold text-dark-200 hover:text-white bg-dark-700/60 hover:bg-dark-700/90 border border-dark-600/40 transition-all">
            <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            Edit Cycle
          </button>
          <button onclick="addNewCycle('${esc(name)}')" class="flex items-center gap-1.5 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all">
            <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
            Add Cycle
          </button>
        </div>
      </div>
    </div>

    ${activeCyc ? `
    <!-- ═══ TRACK STATUS BANNER ═══ -->
    ${(() => {
      const bkPace = getBookingPacing(activeCyc);
      const trackStatus = isOnTrack(activeCyc);
      const paceStatus = bkPace ? bkPace.status : null;
      // Determine overall status: on-track, close, behind, or unknown
      let overallStatus = 'unknown';
      let statusLabel = 'No Data Yet';
      let statusColor = '#64748b';
      let statusBg = 'rgba(100,116,139,0.1)';
      let statusBorder = 'rgba(100,116,139,0.2)';
      let statusIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01"/>';
      if (paceStatus === 'on-track' || trackStatus === true) {
        overallStatus = 'on-track';
        statusLabel = 'On Track';
        statusColor = '#22c55e';
        statusBg = 'rgba(34,197,94,0.08)';
        statusBorder = 'rgba(34,197,94,0.25)';
        statusIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>';
      } else if (paceStatus === 'close') {
        overallStatus = 'close';
        statusLabel = 'Close — Needs Attention';
        statusColor = '#eab308';
        statusBg = 'rgba(234,179,8,0.08)';
        statusBorder = 'rgba(234,179,8,0.25)';
        statusIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"/>';
      } else if (paceStatus === 'behind' || trackStatus === false) {
        overallStatus = 'behind';
        statusLabel = 'Off Track';
        statusColor = '#ef4444';
        statusBg = 'rgba(239,68,68,0.08)';
        statusBorder = 'rgba(239,68,68,0.25)';
        statusIcon = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>';
      }
      const pctBooked = bkPace ? Math.round(bkPace.currentBooked / bkPace.bookedGoal * 100) : 0;
      const pctElapsed = bkPace ? Math.round(bkPace.pctElapsed * 100) : 0;

      return `<div class="rounded-2xl p-4 md:p-5 mb-5 border" style="background:${statusBg};border-color:${statusBorder};">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 md:w-11 md:h-11 rounded-xl flex items-center justify-center flex-shrink-0" style="background:${statusColor}15;">
              <svg class="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="${statusColor}" viewBox="0 0 24 24">${statusIcon}</svg>
            </div>
            <div>
              <div class="text-base md:text-lg font-extrabold" style="color:${statusColor}">${statusLabel}</div>
              <div class="text-dark-400 text-[10px] md:text-xs">${activeCyc.cycle} · ${bkPace ? bkPace.daysLeft + 'd remaining' : 'Cycle active'}</div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xl md:text-2xl font-extrabold text-white">${fmt(activeCyc.bookedAppts)} <span class="text-xs md:text-sm font-medium text-dark-400">/ ${fmt(activeCyc.bookedGoal)}</span></div>
            <div class="text-[10px] md:text-xs text-dark-400">booked appointments</div>
          </div>
        </div>
        ${bkPace ? `
        <div class="relative h-3 rounded-full overflow-hidden mb-2" style="background:rgba(255,255,255,0.06);">
          <div class="absolute inset-y-0 left-0 rounded-full transition-all" style="width:${Math.min(100, pctBooked)}%;background:${statusColor};"></div>
          <div class="absolute inset-y-0 border-r-2 border-dashed" style="left:${pctElapsed}%;border-color:rgba(255,255,255,0.25);" title="${pctElapsed}% of cycle elapsed"></div>
        </div>
        <div class="flex justify-between text-[10px] text-dark-400">
          <span>${pctBooked}% of goal booked</span>
          <span>Projected: ~${bkPace.projectedTotal} bookings</span>
          <span>${pctElapsed}% of cycle elapsed</span>
        </div>
        ` : ''}
      </div>`;
    })()}

    <!-- ═══ KEY METRICS ROW ═══ -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-5">
      <div class="glass rounded-2xl p-4 kpi-card">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">Total Leads</div>
        <div class="text-xl font-extrabold text-white mt-1">${fmt(activeCyc.totalLeads)}</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">Est. Booked</div>
        <div class="text-xl font-extrabold ${isOnTrack(activeCyc) === true ? 'metric-good' : isOnTrack(activeCyc) === false ? 'metric-bad' : 'text-white'} mt-1">${fmt(activeCyc.estBookedAppts)}</div>
        <div class="text-xs text-dark-400 mt-0.5">80% threshold = ${activeCyc.bookedGoal ? fmt(Math.ceil(activeCyc.bookedGoal * 0.8)) : '—'}</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">CPA</div>
        <div class="text-xl font-extrabold ${cpaColor(activeCyc.cpa, cpaGoal)} mt-1">${fmtDollar(activeCyc.cpa,2)}</div>
        <div class="text-xs text-dark-400 mt-0.5">Goal: ${fmtDollar(cpaGoal,2)}</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">Spent / Budget</div>
        <div class="text-xl font-extrabold text-white mt-1">${fmtDollar(activeCyc.amountSpent,0)}</div>
        <div class="text-xs text-dark-400 mt-0.5">of ${fmtDollar(activeCyc.monthlyBudget || acct.monthlyBudget)}</div>
      </div>
      <div class="glass rounded-2xl p-4 kpi-card">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">OSA / Freq</div>
        <div class="text-xl font-extrabold ${osaColor(activeCyc.osaPct)} mt-1">${fmtPct(activeCyc.osaPct)}</div>
        <div class="text-xs text-dark-400 mt-0.5">Freq: ${activeCyc.frequency ? activeCyc.frequency.toFixed(2) : '—'} ${activeCyc.frequency && activeCyc.frequency > 2.5 ? '<span class="text-red-400">⚠</span>' : ''}</div>
      </div>
    </div>

    <!-- ═══ L2B + Greg CPL Row ═══ -->
    ${(() => {
      const l2b = getLeadToBookedRate(name, 45);
      const gregCPL = getGregLeadCPLGoal(cpaGoal, l2b);
      const acctLeads45d = allLeads.filter(l => {
        const nm = l.subAccount.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(l.subAccount.toLowerCase());
        const cutoff45 = new Date(Date.now() - 45*86400000);
        const cs = cutoff45.getFullYear()+'-'+String(cutoff45.getMonth()+1).padStart(2,'0')+'-'+String(cutoff45.getDate()).padStart(2,'0');
        return nm && l.date && l.date >= cs;
      });
      const booked45 = acctLeads45d.filter(l => isBookedStatus(l.status)).length;

      return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div class="glass rounded-xl p-4">
          <div class="text-dark-400 text-[10px] uppercase tracking-wider mb-2">Lead-to-Booked Rate (45d)</div>
          ${l2b !== null ? `
            <div class="text-xl font-bold ${l2b >= 0.375 ? 'metric-good' : 'metric-warn'}">${(l2b*100).toFixed(1)}%</div>
            <div class="text-xs text-dark-400 mt-1">${booked45} booked / ${acctLeads45d.length} leads</div>
            <div class="pacing-bar mt-2"><div class="pacing-fill" style="width:${Math.min(100,l2b*100*1.67)}%;background:${l2b >= 0.375 ? '#22c55e' : '#eab308'};"></div></div>
            <div class="text-[10px] text-dark-400 mt-1">Greg clamps at 37.5%–60%</div>
          ` : '<div class="text-dark-400 text-sm mt-2">Not enough data (&lt;3 leads in 45d)</div>'}
        </div>

        <div class="glass rounded-xl p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-dark-400 text-[10px] uppercase tracking-wider">Greg Guardrails</div>
            <button onclick="document.getElementById('greg-settings-edit').classList.toggle('hidden')" class="text-[9px] text-dark-500 hover:text-brand-400 transition-colors" title="Edit Greg Settings">⚙️ Adjust</button>
          </div>
          ${(() => {
            const currentCPL = (activeCyc.amountSpent && activeCyc.totalLeads && activeCyc.totalLeads > 0) ? activeCyc.amountSpent / activeCyc.totalLeads : null;
            const cpcMed = activeCyc.cpcMedian || null;
            const cpcMult = activeCyc.cpcMultiplier || 1.4;
            const cappedMed = cpcMed ? Math.min(cpcMed, 6) : null;
            const maxCPC = cappedMed ? cappedMed * cpcMult : null;
            const currentCPC = activeCyc.linkCPC || null;
            return '<div class="grid grid-cols-2 gap-x-4 gap-y-2">' +
              '<div>' +
                '<div class="text-xs text-dark-400">Lead CPL Goal</div>' +
                '<div class="text-xl font-bold text-white">' + (gregCPL !== null ? fmtDollar(gregCPL,2) : '—') + '</div>' +
                (gregCPL !== null ? '<div class="text-[11px] text-dark-400">' + fmtDollar(cpaGoal,2) + ' × ' + (Math.min(0.60,Math.max(0.375,l2b))*100).toFixed(1) + '% L2B</div>' : '') +
                (currentCPL !== null && gregCPL !== null ? '<div class="text-xs mt-1 ' + (currentCPL <= gregCPL ? 'metric-good' : 'metric-bad') + '">Now: ' + fmtDollar(currentCPL,2) + ' ' + (currentCPL <= gregCPL ? '✓' : '⚠') + '</div>' : '') +
              '</div>' +
              '<div>' +
                '<div class="text-xs text-dark-400">CPC Median</div>' +
                '<div class="text-xl font-bold text-white">' + (cpcMed ? fmtDollar(cpcMed,2) : '—') + '</div>' +
                '<div class="text-[11px] text-dark-400">× ' + cpcMult + ' = ' + (maxCPC ? fmtDollar(maxCPC,2) + ' max' : '—') + '</div>' +
                (currentCPC && maxCPC ? '<div class="text-xs mt-1 ' + (currentCPC < maxCPC ? 'metric-good' : 'metric-bad') + '">Now: ' + fmtDollar(currentCPC,2) + ' ' + (currentCPC < maxCPC ? '✓' : '⚠') + '</div>' : '') +
              '</div>' +
            '</div>';
          })()}
          <div id="greg-settings-edit" class="hidden mt-3 pt-3 border-t border-dark-600/40 space-y-3">
            <div>
              <label class="text-[10px] text-dark-500">Greg Goal Override (Booked Appointments)</label>
              <div class="text-[9px] text-dark-400 mt-0.5 mb-1.5">Raise to tighten CPL threshold. Greg derives lead CPL from this × L2B rate.</div>
              <div class="flex gap-2">
                <input id="qe-greg-goal" type="number" step="1" value="${activeCyc ? activeCyc.gregGoal||'' : ''}" class="flex-1 bg-dark-700/80 border border-dark-600/50 rounded-lg text-xs text-white px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="e.g. 40" />
                <button onclick="saveGregGoal('${esc(name)}','${activeCyc ? esc(activeCyc.cycle) : ''}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 transition-all text-red-300">Save</button>
              </div>
              <div class="text-[9px] text-red-400/70 mt-1">⚠ Setting too high will aggressively pause ads.</div>
            </div>
            <div>
              <label class="text-[10px] text-dark-500">CPC Multiplier</label>
              <div class="text-[9px] text-dark-400 mt-0.5 mb-1.5">Default 1.4×. Video ads always use 2×. Lower = stricter.</div>
              <div class="flex gap-2">
                <input id="qe-cpc-mult" type="number" step="0.1" min="1" max="3" value="${activeCyc.cpcMultiplier || ''}" class="flex-1 bg-dark-700/80 border border-dark-600/50 rounded-lg text-xs text-white px-2 py-1.5 focus:outline-none focus:border-brand-500" placeholder="1.4 (default)" />
                <button onclick="saveCpcSettings('${esc(name)}','${activeCyc ? esc(activeCyc.cycle) : ''}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white bg-brand-500/20 hover:bg-brand-500/30 border border-brand-500/30 transition-all">Save</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    })()}

      <!-- Quick Edit modal is now rendered by openQuickEditModal() -->

    <!-- Conversion Funnel -->
    ${(() => {
      const cycleLeads = activeCyc ? getLeadsForAccount(name, activeCyc.cycleStartDate, activeCyc.cycleEndDate) : [];
      if (cycleLeads.length === 0) return '';
      const total = cycleLeads.length;
      const booked = cycleLeads.filter(l => isBookedStatus(l.status)).length;
      const client = cycleLeads.filter(l => isClientHandles(l.status)).length;
      const cancelled = cycleLeads.filter(l => isCancelledStatus(l.status)).length;
      const open = cycleLeads.filter(l => isOpenStatus(l.status)).length;
      const bkRate = total > 0 ? (booked/total*100).toFixed(1) : '0';
      return `<div class="glass rounded-2xl p-5 mb-6">
        <div class="flex items-center gap-2 mb-4">
          <div class="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center"><svg class="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"/></svg></div>
          <span class="text-dark-300 text-xs font-semibold uppercase tracking-wider">Conversion Funnel — Active Cycle</span>
        </div>
        <div class="space-y-2.5">
          <div><div class="flex items-center justify-between text-xs mb-1"><span class="text-dark-200">Total Leads</span><span class="text-white font-semibold">${total}</span></div><div class="funnel-bar" style="width:100%;background:rgba(59,130,246,0.3);color:#93c5fd;">100%</div></div>
          <div><div class="flex items-center justify-between text-xs mb-1"><span class="lead-booked">Booked</span><span class="text-white font-semibold">${booked}</span></div><div class="funnel-bar" style="width:${Math.max(5,booked/total*100)}%;background:rgba(34,197,94,0.3);color:#86efac;">${bkRate}%</div></div>
          <div><div class="flex items-center justify-between text-xs mb-1"><span class="lead-client">Other</span><span class="text-white font-semibold">${client}</span></div><div class="funnel-bar" style="width:${Math.max(3,client/total*100)}%;background:rgba(251,191,36,0.2);color:#fde68a;">${(client/total*100).toFixed(1)}%</div></div>
          <div><div class="flex items-center justify-between text-xs mb-1"><span class="lead-open">Open</span><span class="text-white font-semibold">${open}</span></div><div class="funnel-bar" style="width:${Math.max(3,open/total*100)}%;background:rgba(226,232,240,0.1);color:#e2e8f0;">${(open/total*100).toFixed(1)}%</div></div>
          <div><div class="flex items-center justify-between text-xs mb-1"><span class="lead-cancelled">Lost</span><span class="text-white font-semibold">${cancelled}</span></div><div class="funnel-bar" style="width:${Math.max(3,cancelled/total*100)}%;background:rgba(239,68,68,0.15);color:#fca5a5;">${(cancelled/total*100).toFixed(1)}%</div></div>
        </div>
      </div>`;
    })()}
    ` : '<div class="glass rounded-xl p-6 mb-6 text-dark-400 text-center">No active cycle</div>'}

    <!-- Trend Charts -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div class="glass rounded-2xl p-5">
        <h3 class="text-white font-bold text-sm mb-3 flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-brand-400"></div>CPA Trend</h3>
        <div class="chart-container"><canvas id="chart-acct-cpa"></canvas></div>
      </div>
      <div class="glass rounded-2xl p-5">
        <h3 class="text-white font-bold text-sm mb-3 flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-emerald-400"></div>Leads & Bookings</h3>
        <div class="chart-container"><canvas id="chart-acct-leads"></canvas></div>
      </div>
    </div>

    <!-- Meta Ad Performance -->
    <div class="glass rounded-2xl p-4 md:p-5 mb-6" id="meta-daily-section">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div class="flex flex-wrap items-center gap-2 md:gap-3">
          <h3 class="text-white font-bold text-sm flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-blue-400"></div>Ad Performance <span class="text-dark-400 text-xs font-normal ml-2 mobile-hide">via Meta API</span></h3>
          ${META_ACCESS_TOKEN && adId && cycles.length > 0 ? `
          <select id="meta-cycle-select" onchange="switchMetaCycle()" class="text-xs bg-dark-700 border border-dark-600 text-dark-200 rounded px-2 py-1 appearance-none pr-7 cursor-pointer" style="min-width:180px;">
            ${(() => {
              const today2 = getTodayStr();
              const hasAnActive = cycles.some(cc => cc.cycleStartDate && cc.cycleEndDate && cc.cycleStartDate <= today2 && cc.cycleEndDate >= today2);
              return cycles.map((c, ci) => {
                const isAct = c.cycleStartDate && c.cycleEndDate && c.cycleStartDate <= today2 && c.cycleEndDate >= today2;
                const shouldSelect = isAct || (!hasAnActive && ci === cycles.length - 1);
                const lbl = c.cycle + (isAct ? ' (Active)' : '') + (c.cycleStartDate ? ' · ' + fmtDate(c.cycleStartDate) : '');
                return '<option value="' + ci + '"' + (shouldSelect ? ' selected' : '') + '>' + lbl + '</option>';
              }).join('');
            })()}
          </select>
          ` : ''}
        </div>
        ${META_ACCESS_TOKEN && adId ? `
        <div class="flex items-center gap-3">
          <div class="flex gap-1.5" id="meta-mode-toggles">
            <button class="px-3 py-1 rounded-md text-xs font-semibold meta-mode-toggle active" data-mode="campaign" onclick="switchMetaMode('campaign')" style="background:rgba(251,146,60,0.2);color:#fdba74;">Campaign</button>
            <button class="px-3 py-1 rounded-md text-xs font-semibold meta-mode-toggle" data-mode="ad" onclick="switchMetaMode('ad')" style="background:rgba(100,116,139,0.15);color:#94a3b8;">Ad View</button>
          </div>
          <div class="flex gap-1.5" id="meta-view-toggles">
            <button class="px-3 py-1 rounded-md meta-view-toggle" data-view="daily" style="background:rgba(100,116,139,0.15);color:#94a3b8;">Daily</button>
            <button class="px-3 py-1 rounded-md meta-view-toggle" data-view="quarters" style="background:rgba(100,116,139,0.15);color:#94a3b8;">Quarters</button>
            <button class="px-3 py-1 rounded-md meta-view-toggle active" data-view="full" style="background:rgba(251,146,60,0.2);color:#fdba74;">Full Cycle</button>
          </div>
        </div>
        ` : ''}
      </div>
      ${META_ACCESS_TOKEN && adId ? `
        <div id="meta-daily-summary" class="mb-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 gap-2 text-center"></div>
        <div id="meta-ad-filters" class="mb-4" style="display:none"></div>
        <div class="chart-container" style="height:200px;"><canvas id="chart-meta-daily"></canvas></div>
        <div id="meta-daily-table" class="mt-4"></div>
      ` : `
        <div class="text-center py-8">
          <div class="text-4xl mb-3">📊</div>
          <div class="text-dark-200 font-medium mb-1">${!META_ACCESS_TOKEN ? 'Meta API Not Connected' : 'No Ad Account ID'}</div>
          <div class="text-dark-400 text-sm mb-3">${!META_ACCESS_TOKEN ? 'Add your Meta access token to see daily ad performance data' : 'This account has no Meta Ad Account ID in the sheet'}</div>
          ${!META_ACCESS_TOKEN ? '<div class="text-dark-500 text-xs font-mono bg-dark-800/50 inline-block px-3 py-1.5 rounded">Line 191: const META_ACCESS_TOKEN = \'your_token_here\';</div>' : ''}
        </div>
      `}
    </div>

    <!-- Lead Breakdown for Active Cycle -->
    <div id="lead-breakdown" class="mb-6"></div>

    <!-- Cycle Comparison -->
    ${cycles.length >= 2 ? (() => {
      const cycOpts = cycles.map((c, i) => `<option value="${i}">${c.cycle}${c.cycle.toLowerCase().includes('winter') ? ' (winter)' : ''}</option>`).join('');
      return `
      <div class="glass rounded-2xl overflow-hidden" id="cycle-comp-section">
        <div class="p-5 border-b border-dark-600/50">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-white font-bold flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-indigo-400"></div>Cycle Comparison</h3>
            <div class="flex items-center gap-2.5">
              <select id="comp-cycle-a" onchange="renderCycleCompCards()" class="bg-dark-800 border border-dark-600/50 rounded-lg text-dark-200 px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-brand-500 cursor-pointer appearance-none min-w-[110px]">${cycOpts}</select>
              <span class="text-dark-500 text-[11px] font-semibold tracking-wide">VS</span>
              <select id="comp-cycle-b" onchange="renderCycleCompCards()" class="bg-dark-800 border border-dark-600/50 rounded-lg text-dark-200 px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-brand-500 cursor-pointer appearance-none min-w-[110px]">${cycOpts}</select>
            </div>
          </div>
          <div id="comp-window-label" class="mt-2 text-[10px]"></div>
        </div>
        <div id="cycle-comp-cards" class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"></div>
      </div>`;
    })() : cycles.length === 1 ? `
      <div class="glass rounded-2xl p-6 text-center">
        <div class="text-dark-400 text-sm">Cycle comparison available after completing at least 2 cycles</div>
      </div>` : ''}

    ${activeCyc && activeCyc.notes ? `
    <div class="glass rounded-xl p-4 mt-4">
      <h4 class="text-dark-400 text-xs uppercase tracking-wider mb-2">Notes</h4>
      <p class="text-dark-200 text-sm">${activeCyc.notes}</p>
    </div>` : ''}
  `;

  if (cycles.length > 1) {
    renderAccountCPAChart(cycles, acct.cpaGoal);
    renderAccountLeadsChart(cycles);
  }

  // Initialize cycle comparison selectors and render cards
  if (cycles.length >= 2) {
    _compCycles = cycles;
    _compCpaGoal = acct.cpaGoal;
    _compAdId = adId || '';
    _compAcctName = acct.name || '';
    const selA = document.getElementById('comp-cycle-a');
    const selB = document.getElementById('comp-cycle-b');
    if (selA && selB) {
      selA.value = cycles.length - 2;
      selB.value = cycles.length - 1;
      renderCycleCompCards();
    }
  }

  // Store context for cycle switching
  _metaCycleAcct = acct;
  _metaCycleAdId = adId;
  _metaCycleList = cycles;

  // Load Meta daily insights for the selected cycle (active or most recent)
  if (META_ACCESS_TOKEN && adId && cycles.length > 0) {
    const selEl = document.getElementById('meta-cycle-select');
    const selIdx = selEl ? parseInt(selEl.value) : -1;
    const selCyc = selIdx >= 0 ? cycles[selIdx] : activeCyc;
    if (selCyc && selCyc.cycleStartDate && selCyc.cycleEndDate) {
      loadMetaDailyInsights(adId, selCyc.cycleStartDate, selCyc.cycleEndDate, selCyc, name);
    }
  }

  renderLeadBreakdown(acct, cycles);
}

// Store current breakdown context so filter clicks can re-render
let _currentBreakdownLeads = [];
let _currentBreakdownCycle = null;
let _currentBreakdownAcct = null;
let _currentBreakdownCycles = [];

function renderLeadBreakdown(acct, cycles, forceCycleIdx) {
  const container = document.getElementById('lead-breakdown');
  if (!container) return;

  _currentBreakdownAcct = acct;
  _currentBreakdownCycles = cycles;

  const accountLeads = allLeads.filter(l =>
    l.subAccount.toLowerCase().includes(acct.name.toLowerCase()) ||
    acct.name.toLowerCase().includes(l.subAccount.toLowerCase())
  );

  if (!accountLeads.length) {
    container.innerHTML = '';
    return;
  }

  const today = getTodayStr();
  let cycleBreakdowns = [];
  cycles.forEach((c, idx) => {
    if (!c.cycleStartDate || !c.cycleEndDate) return;
    const start = c.cycleStartDate;
    const end = c.cycleEndDate;
    const cycleLeads = accountLeads.filter(l => l.date && l.date >= start && l.date <= end);
    const isActiveCyc = c.cycleStartDate <= today && c.cycleEndDate >= today;
    if (cycleLeads.length > 0 || isActiveCyc) {
      cycleBreakdowns.push({ cycle: c, leads: cycleLeads, isActive: isActiveCyc, idx });
    }
  });

  if (!cycleBreakdowns.length && accountLeads.length > 0) {
    cycleBreakdowns.push({ cycle: { cycle: 'All Leads' }, leads: accountLeads, isActive: true, idx: -1 });
  }

  if (!cycleBreakdowns.length) { container.innerHTML = ''; return; }

  // If a specific cycle index was requested (from clicking cycle history), use that
  let activeBreakdown;
  if (forceCycleIdx !== undefined) {
    activeBreakdown = cycleBreakdowns.find(b => b.idx === forceCycleIdx) || cycleBreakdowns[cycleBreakdowns.length - 1];
  } else {
    activeBreakdown = cycleBreakdowns.find(b => b.isActive) || cycleBreakdowns[cycleBreakdowns.length - 1];
  }

  const leads = activeBreakdown.leads;
  _currentBreakdownLeads = leads;
  _currentBreakdownCycle = activeBreakdown.cycle;

  // Apply filter
  const filtered = activeLeadFilter === 'all' ? leads :
    activeLeadFilter === 'booked' ? leads.filter(l => isBookedStatus(l.status)) :
    activeLeadFilter === 'client' ? leads.filter(l => isClientHandles(l.status)) :
    activeLeadFilter === 'cancelled' ? leads.filter(l => isCancelledStatus(l.status)) :
    leads.filter(l => isOpenStatus(l.status));

  // Group by date
  const byDate = {};
  filtered.forEach(l => {
    const d = l.date || 'Unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(l);
  });
  const dates = Object.keys(byDate).sort().reverse();
  // Reverse leads within each day so newest lead appears first
  dates.forEach(d => byDate[d].reverse());

  // Group by week (from all leads, not filtered)
  const weeks = { 'Week 1': [], 'Week 2': [], 'Week 3': [], 'Week 4': [], 'Week 5+': [] };
  if (activeBreakdown.cycle.cycleStartDate) {
    const startMs = parseLocalDate(activeBreakdown.cycle.cycleStartDate).getTime();
    leads.forEach(l => {
      if (!l.date) return;
      const dayDiff = Math.floor((parseLocalDate(l.date).getTime() - startMs) / (86400000));
      if (dayDiff < 7) weeks['Week 1'].push(l);
      else if (dayDiff < 14) weeks['Week 2'].push(l);
      else if (dayDiff < 21) weeks['Week 3'].push(l);
      else if (dayDiff < 28) weeks['Week 4'].push(l);
      else weeks['Week 5+'].push(l);
    });
  }

  const booked = leads.filter(l => isBookedStatus(l.status)).length;
  const clientH = leads.filter(l => isClientHandles(l.status)).length;
  const cancelled = leads.filter(l => isCancelledStatus(l.status)).length;
  const open = leads.filter(l => isOpenStatus(l.status)).length;

  const fActive = (f) => activeLeadFilter === f ? 'active' : '';

  container.innerHTML = `
    <div class="glass rounded-xl p-5">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <h3 class="text-white font-semibold text-base">Lead Breakdown</h3>
          <select id="lead-breakdown-cycle-select" onchange="showCycleLeads(parseInt(this.value))" class="bg-dark-700/80 border border-dark-600/50 rounded-lg text-xs text-white px-2 py-1.5 focus:outline-none focus:border-brand-500 cursor-pointer">
            ${cycleBreakdowns.map(b => {
              const sel = b.idx === activeBreakdown.idx ? 'selected' : '';
              return '<option value="' + b.idx + '" ' + sel + '>' + b.cycle.cycle + (b.isActive ? ' (Active)' : '') + '</option>';
            }).join('')}
          </select>
        </div>
        <div class="flex gap-2 flex-wrap">
          <span class="filter-badge fb-green ${fActive('booked')}" onclick="setLeadFilter('booked')">${booked} booked</span>
          <span class="filter-badge fb-yellow ${fActive('client')}" onclick="setLeadFilter('client')">${clientH} other</span>
          <span class="filter-badge fb-red ${fActive('cancelled')}" onclick="setLeadFilter('cancelled')">${cancelled} lost</span>
          <span class="filter-badge fb-white ${fActive('open')}" onclick="setLeadFilter('open')">${open} open</span>
          <span class="filter-badge fb-blue ${fActive('all')}" onclick="setLeadFilter('all')">${leads.length} total</span>
        </div>
      </div>

      <!-- Week Breakdown -->
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
        ${Object.entries(weeks).filter(([k,v]) => v.length > 0 || k !== 'Week 5+').slice(0,4).map(([week, wLeads]) => {
          const wBooked = wLeads.filter(l => isBookedStatus(l.status)).length;
          const wClient = wLeads.filter(l => isClientHandles(l.status)).length;
          const wCancelled = wLeads.filter(l => isCancelledStatus(l.status)).length;
          const wOpen = wLeads.filter(l => isOpenStatus(l.status)).length;
          return `
          <div class="bg-dark-800/50 rounded-lg p-3">
            <div class="text-dark-400 text-[10px] uppercase tracking-wider mb-1">${week}</div>
            <div class="text-white font-bold text-lg">${wLeads.length}</div>
            <div class="text-xs"><span class="lead-booked">${wBooked} bkd</span> · <span class="lead-client">${wClient} oth</span> · <span class="lead-cancelled">${wCancelled} lost</span> · <span class="lead-open">${wOpen} open</span></div>
          </div>`;
        }).join('')}
        ${weeks['Week 5+'].length > 0 ? `
        <div class="bg-dark-800/50 rounded-lg p-3">
          <div class="text-dark-400 text-[10px] uppercase tracking-wider mb-1">Week 5+</div>
          <div class="text-white font-bold text-lg">${weeks['Week 5+'].length}</div>
        </div>` : ''}
      </div>

      <!-- Showing filter info -->
      ${activeLeadFilter !== 'all' ? `<div class="text-dark-400 text-xs mb-2">Showing ${filtered.length} ${activeLeadFilter} leads · <span class="text-brand-400 cursor-pointer" onclick="setLeadFilter('all')">show all</span></div>` : ''}

      <!-- Day-by-Day with individual leads -->
      <div class="overflow-x-auto" style="max-height: 500px; overflow-y: auto;">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-dark-700 z-10">
            <tr class="border-b border-dark-600 text-dark-400 uppercase tracking-wider">
              <th class="text-left py-2 px-2 font-medium">Date</th>
              <th class="text-left py-2 px-2 font-medium">Name</th>
              <th class="text-left py-2 px-2 font-medium mobile-hide">Address</th>
              <th class="text-left py-2 px-2 font-medium mobile-hide">Distance &amp; Drive Time</th>
              <th class="text-left py-2 px-2 font-medium">Status</th>
              <th class="text-left py-2 px-2 font-medium mobile-hide">Last Note</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? '<tr><td colspan="6" class="py-4 px-2 text-dark-400 text-center">No leads match this filter</td></tr>' : ''}
            ${dates.map(d => {
              const dayLeads = byDate[d];
              return dayLeads.map((l, li) => `
              <tr class="border-b border-dark-700/30">
                ${li === 0 ? `<td class="py-1.5 px-2 text-dark-200 whitespace-nowrap align-top" rowspan="${dayLeads.length}">${fmtDate(d)} <span class="text-dark-500">(${dayLeads.length})</span></td>` : ''}
                <td class="py-1.5 px-2 ${leadStatusColor(l.status)}">${l.name || '—'}</td>
                <td class="py-1.5 px-2 text-dark-300 mobile-hide" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(l.address||'').replace(/"/g,'&quot;')}">${l.address || '<span class="text-dark-600">—</span>'}</td>
                <td class="py-1.5 px-2 text-dark-300 whitespace-nowrap mobile-hide">${l.distance || '<span class="text-dark-600">—</span>'}</td>
                <td class="py-1.5 px-2 ${leadStatusColor(l.status)}">${l.status || '—'}</td>
                <td class="py-1.5 px-2 text-dark-400 mobile-hide" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(l.lastNote||'').replace(/"/g,'&quot;')}">${l.lastNote || '<span class="text-dark-600">—</span>'}</td>
              </tr>`).join('');
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Click handler for filter badges — toggles filter and re-renders
function setLeadFilter(filter) {
  activeLeadFilter = activeLeadFilter === filter ? 'all' : filter;
  if (_currentBreakdownAcct && _currentBreakdownCycles.length) {
    const cycleIdx = _currentBreakdownCycles.indexOf(_currentBreakdownCycle);
    renderLeadBreakdown(_currentBreakdownAcct, _currentBreakdownCycles, cycleIdx >= 0 ? cycleIdx : undefined);
  }
}

// Click handler for cycle history rows
function showCycleLeads(cycleIdx) {
  activeLeadFilter = 'all';
  if (_currentBreakdownAcct && _currentBreakdownCycles.length) {
    renderLeadBreakdown(_currentBreakdownAcct, _currentBreakdownCycles, cycleIdx);
    document.getElementById('lead-breakdown')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ═══ Cycle Comparison — Same-Window Comparison ═══
let _compCycles = [];
let _compCpaGoal = null;
let _compCharts = {};
let _compAdId = '';
let _compAcctName = '';

async function renderCycleCompCards() {
  const container = document.getElementById('cycle-comp-cards');
  const windowLabel = document.getElementById('comp-window-label');
  if (!container || !_compCycles.length) return;

  const idxA = parseInt(document.getElementById('comp-cycle-a')?.value ?? 0);
  const idxB = parseInt(document.getElementById('comp-cycle-b')?.value ?? 1);
  const a = _compCycles[idxA];
  const b = _compCycles[idxB];
  if (!a || !b) return;

  // Show loading state
  container.innerHTML = '<div class="col-span-full flex items-center justify-center py-8 gap-2"><span class="inline-block w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin"></span><span class="text-dark-400 text-xs">Comparing cycles…</span></div>';
  if (windowLabel) windowLabel.textContent = '';

  // Destroy old sparkline charts
  Object.values(_compCharts).forEach(c => { try { c.destroy(); } catch {} });
  _compCharts = {};

  // Calculate days elapsed for each cycle
  const today = getTodayStr();
  const daysElapsed = (cyc) => {
    if (!cyc.cycleStartDate || !cyc.cycleEndDate) return 28;
    const start = new Date(cyc.cycleStartDate + 'T00:00:00');
    const end = new Date(cyc.cycleEndDate + 'T00:00:00');
    const now = new Date(today + 'T00:00:00');
    const total = Math.round((end - start) / 86400000) + 1;
    if (now >= end) return total;
    if (now < start) return 0;
    return Math.round((now - start) / 86400000) + 1;
  };
  const cycleTotalDays = (cyc) => {
    if (!cyc.cycleStartDate || !cyc.cycleEndDate) return 28;
    return Math.round((new Date(cyc.cycleEndDate+'T00:00:00') - new Date(cyc.cycleStartDate+'T00:00:00')) / 86400000) + 1;
  };

  const daysA = daysElapsed(a);
  const daysB = daysElapsed(b);
  const compWindow = Math.min(daysA, daysB);
  const totalA = cycleTotalDays(a);
  const totalB = cycleTotalDays(b);
  const isWindowed = compWindow < Math.max(totalA, totalB);
  const isCurrentA = daysA < totalA;
  const isCurrentB = daysB < totalB;

  let aggA = null, aggB = null;
  let usedDailyData = false;

  // Try same-window comparison using daily Meta data
  if (_compAdId && META_ACCESS_TOKEN && a.cycleStartDate && b.cycleStartDate && compWindow > 0) {
    try {
      // Fetch full date ranges (cache-friendly), then slice to window
      const [dailyA, dailyB] = await Promise.all([
        fetchMetaDailyInsights(_compAdId, a.cycleStartDate, a.cycleEndDate),
        fetchMetaDailyInsights(_compAdId, b.cycleStartDate, b.cycleEndDate),
      ]);

      if (dailyA?.length && dailyB?.length) {
        // Enrich both with booking data
        if (_compAcctName) {
          [dailyA, dailyB].forEach((data, i) => {
            const cyc = i === 0 ? a : b;
            const cycleLeads = getLeadsForAccount(_compAcctName, cyc.cycleStartDate, cyc.cycleEndDate);
            const bookedByDate = {};
            cycleLeads.forEach(l => {
              if (isBookedStatus(l.status) && l.date) {
                bookedByDate[l.date] = (bookedByDate[l.date] || 0) + 1;
              }
            });
            data.forEach(d => { d.dailyBookings = bookedByDate[d.date] || 0; });
          });
        }

        // Slice to same window
        const sliceA = dailyA.slice(0, compWindow);
        const sliceB = dailyB.slice(0, compWindow);

        if (sliceA.length && sliceB.length) {
          aggA = aggregateDays(sliceA);
          aggB = aggregateDays(sliceB);
          usedDailyData = true;
        }
      }
    } catch (e) {
      console.warn('Cycle comparison fetch error:', e);
    }
  }

  // Override lead counts from lead breakdown sheet instead of Meta/metadata
  if (_compAcctName) {
    const sheetLeadsA = getLeadsForAccount(_compAcctName, a.cycleStartDate, a.cycleEndDate);
    const sheetLeadsB = getLeadsForAccount(_compAcctName, b.cycleStartDate, b.cycleEndDate);
    // If using windowed daily data, only count leads within the comparison window
    let leadCountA, leadCountB;
    if (usedDailyData && aggA && aggB) {
      const windowEndA = new Date(new Date(a.cycleStartDate + 'T00:00:00').getTime() + (compWindow - 1) * 86400000);
      const windowEndAStr = windowEndA.toISOString().slice(0, 10);
      const windowEndB = new Date(new Date(b.cycleStartDate + 'T00:00:00').getTime() + (compWindow - 1) * 86400000);
      const windowEndBStr = windowEndB.toISOString().slice(0, 10);
      leadCountA = sheetLeadsA.filter(l => l.date && l.date <= windowEndAStr).length;
      leadCountB = sheetLeadsB.filter(l => l.date && l.date <= windowEndBStr).length;
    } else {
      leadCountA = sheetLeadsA.length;
      leadCountB = sheetLeadsB.length;
    }
    if (aggA) {
      aggA.leads = leadCountA;
      aggA.cpl = leadCountA > 0 ? aggA.spend / leadCountA : 0;
    }
    if (aggB) {
      aggB.leads = leadCountB;
      aggB.cpl = leadCountB > 0 ? aggB.spend / leadCountB : 0;
    }
  }

  // Fallback to sheet-level cycle totals
  if (!aggA || !aggB) {
    const fallbackLeadsA = _compAcctName ? getLeadsForAccount(_compAcctName, a.cycleStartDate, a.cycleEndDate).length : (a.totalLeads || 0);
    const fallbackLeadsB = _compAcctName ? getLeadsForAccount(_compAcctName, b.cycleStartDate, b.cycleEndDate).length : (b.totalLeads || 0);
    aggA = { spend: a.amountSpent || 0, leads: fallbackLeadsA, bookings: a.bookedAppts || 0,
             cpl: fallbackLeadsA > 0 ? (a.amountSpent || 0) / fallbackLeadsA : 0, cpa: a.cpa || 0 };
    aggB = { spend: b.amountSpent || 0, leads: fallbackLeadsB, bookings: b.bookedAppts || 0,
             cpl: fallbackLeadsB > 0 ? (b.amountSpent || 0) / fallbackLeadsB : 0, cpa: b.cpa || 0 };
  }

  // Update window label
  if (windowLabel) {
    if (usedDailyData && isWindowed) {
      const currentLabel = isCurrentA ? a.cycle : isCurrentB ? b.cycle : '';
      windowLabel.innerHTML = `<span class="text-dark-400">📊 Comparing first <span class="text-brand-400 font-semibold">${compWindow} days</span> of each cycle${currentLabel ? ` · ${currentLabel} is day ${compWindow} of ${isCurrentA ? totalA : totalB}` : ''}</span>`;
    } else if (usedDailyData) {
      windowLabel.innerHTML = `<span class="text-dark-400">📊 Full cycle comparison · ${aggA.days || compWindow} vs ${aggB.days || compWindow} days</span>`;
    } else {
      windowLabel.innerHTML = `<span class="text-dark-500">⚠ Using cycle totals (daily data unavailable)</span>`;
    }
  }

  // 5 Metrics: Leads, Bookings, Spend, CPL, CPA
  const pctChg = (prev, curr) => prev && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;

  const metrics = [
    { key: 'leads',    label: 'Leads',    valA: aggA.leads,    valB: aggB.leads,    fmt: 'n', lower: false, color: '#3b82f6' },
    { key: 'bookings', label: 'Bookings', valA: aggA.bookings, valB: aggB.bookings, fmt: 'n', lower: false, color: '#22c55e' },
    { key: 'spend',    label: 'Spend',    valA: aggA.spend,    valB: aggB.spend,    fmt: '$', lower: null,  color: '#fbbf24' },
    { key: 'cpl',      label: 'CPL',      valA: aggA.cpl,      valB: aggB.cpl,      fmt: '$', lower: true,  color: '#a78bfa' },
    { key: 'cpa',      label: 'CPA',      valA: aggA.cpa,      valB: aggB.cpa,      fmt: '$', lower: true,  color: '#f97316' },
  ];

  const fmtV = (v, type) => {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (type === '$') return fmtDollar(v, 2);
    return fmt(v);
  };

  container.innerHTML = metrics.map(m => {
    const pct = pctChg(m.valA, m.valB);
    let arrow = '', chgColor = 'text-dark-500', chgText = '—';
    if (pct !== null && !isNaN(pct)) {
      arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
      if (m.lower === null) {
        // Neutral metric (Spend) — show direction without good/bad coloring
        chgColor = 'text-dark-300';
      } else {
        const improved = m.lower ? pct < 0 : pct > 0;
        chgColor = improved ? 'text-emerald-400' : 'text-red-400';
      }
      chgText = `${arrow} ${Math.abs(pct).toFixed(1)}%`;
    }
    return `
    <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30">
      <div class="flex items-center justify-between mb-1">
        <span class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold">${m.label}</span>
        <span class="${chgColor} text-[11px] font-bold">${chgText}</span>
      </div>
      <div class="text-white text-lg font-extrabold mb-0.5">${fmtV(m.valB, m.fmt)}</div>
      <div class="text-dark-500 text-[10px] mb-2">was ${fmtV(m.valA, m.fmt)}</div>
      <div style="height:36px;"><canvas id="comp-spark-${m.key}"></canvas></div>
    </div>`;
  }).join('');

  // Render sparklines using full-cycle sheet data for all-cycle trend overview
  // Use lead breakdown sheet for lead counts instead of metadata
  const sparkLeadCounts = _compCycles.map(c => {
    if (_compAcctName && c.cycleStartDate && c.cycleEndDate) {
      return getLeadsForAccount(_compAcctName, c.cycleStartDate, c.cycleEndDate).length;
    }
    return c.totalLeads || 0;
  });
  const sparkData = {
    leads:    sparkLeadCounts,
    bookings: _compCycles.map(c => c.bookedAppts || 0),
    spend:    _compCycles.map(c => c.amountSpent || 0),
    cpl:      sparkLeadCounts.map((lc, i) => lc > 0 ? (_compCycles[i].amountSpent || 0) / lc : 0),
    cpa:      _compCycles.map(c => c.cpa || 0),
  };
  const labels = _compCycles.map(c => c.cycle.replace('Cycle ', 'C'));

  metrics.forEach(m => {
    const ctx = document.getElementById(`comp-spark-${m.key}`);
    if (!ctx) return;
    const pointRadius = _compCycles.map((_, i) => (i === idxA || i === idxB) ? 3.5 : 1.5);
    const pointBg = _compCycles.map((_, i) => (i === idxA || i === idxB) ? m.color : m.color + '40');

    _compCharts[m.key] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: sparkData[m.key],
          borderColor: m.color,
          backgroundColor: m.color + '10',
          fill: true,
          tension: 0.4,
          borderWidth: 1.5,
          pointRadius,
          pointBackgroundColor: pointBg,
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1,
          pointHoverRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
            borderColor: 'rgba(100,116,139,0.2)', borderWidth: 1, cornerRadius: 6, padding: 8,
            titleFont: { family: 'Inter', size: 10 }, bodyFont: { family: 'Inter', size: 11 },
            callbacks: { label: tip => m.fmt === '$' ? '$' + Number(tip.raw).toFixed(2) : String(tip.raw) } } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  });
}

function renderAccountCPAChart(cycles, goalCPA) {
  const ctx = document.getElementById('chart-acct-cpa');
  if (!ctx) return;
  const labels = cycles.map(c => c.cycle.replace('Cycle ','C'));
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'CPA', data: cycles.map(c => c.cpa), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.08)', fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#f97316', pointBorderColor: '#1e293b', pointBorderWidth: 2, borderWidth: 2.5 },
        ...(goalCPA ? [{ label: 'Goal', data: cycles.map(() => goalCPA), borderColor: 'rgba(148,163,184,0.35)', borderDash: [6,4], pointRadius: 0, fill: false, borderWidth: 1.5 }] : [])
      ]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 10, family: 'Inter' }, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
        tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', borderColor: 'rgba(100,116,139,0.2)', borderWidth: 1, cornerRadius: 8, padding: 10,
          titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
          callbacks: { label: tip => `${tip.dataset.label}: $${tip.raw.toFixed(2)}` } } },
      scales: { x: { ticks: { color: '#64748b', font: { size: 9, family: 'Inter' } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', callback: v => '$'+v }, grid: { color: 'rgba(100,116,139,0.06)' } } }
    }
  });
}

function renderAccountLeadsChart(cycles) {
  const ctx = document.getElementById('chart-acct-leads');
  if (!ctx) return;
  const labels = cycles.map(c => c.cycle.replace('Cycle ','C'));
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Leads', data: cycles.map(c => c.totalLeads), backgroundColor: 'rgba(59,130,246,0.5)', borderColor: 'rgba(59,130,246,0.7)', borderWidth: 1, borderRadius: 6, borderSkipped: false },
        { label: 'Booked', data: cycles.map(c => c.bookedAppts), backgroundColor: 'rgba(34,197,94,0.5)', borderColor: 'rgba(34,197,94,0.7)', borderWidth: 1, borderRadius: 6, borderSkipped: false }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 10, family: 'Inter' }, usePointStyle: true, pointStyle: 'rect', padding: 16 } },
        tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', borderColor: 'rgba(100,116,139,0.2)', borderWidth: 1, cornerRadius: 8, padding: 10,
          titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' } } },
      scales: { x: { ticks: { color: '#64748b', font: { size: 9, family: 'Inter' } }, grid: { display: false } },
        y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(100,116,139,0.06)' } } }
    }
  });
}

// ═══════════════════════════════════════════════
// META DAILY INSIGHTS CHART
// ═══════════════════════════════════════════════
let metaDailyChart = null;
let metaDailyData = null;
let metaCurrentView = 'daily'; // 'daily', 'quarters', or 'full'
let metaCurrentCycle = null; // store cycle context for CPA calc
let metaAccountName = '';

// Cycle selector context
let _metaCycleAcct = null;
let _metaCycleAdId = '';
let _metaCycleList = [];

function switchMetaCycle() {
  const selEl = document.getElementById('meta-cycle-select');
  if (!selEl || !_metaCycleAcct || !_metaCycleAdId) return;
  const idx = parseInt(selEl.value);
  const cyc = _metaCycleList[idx];
  if (!cyc || !cyc.cycleStartDate || !cyc.cycleEndDate) return;
  // Reset view toggles to Full Cycle default
  document.querySelectorAll('.meta-view-toggle').forEach(b => { b.style.background = 'rgba(100,116,139,0.15)'; b.style.color = '#94a3b8'; b.classList.remove('active'); });
  const fullBtn = document.querySelector('.meta-view-toggle[data-view="full"]');
  if (fullBtn) { fullBtn.classList.add('active'); fullBtn.style.background = 'rgba(251,146,60,0.2)'; fullBtn.style.color = '#fdba74'; }
  if (metaViewMode === 'ad') {
    loadMetaAdInsights(_metaCycleAdId, cyc.cycleStartDate, cyc.cycleEndDate);
  } else {
    loadMetaDailyInsights(_metaCycleAdId, cyc.cycleStartDate, cyc.cycleEndDate, cyc, _metaCycleAcct.name);
  }
}

function aggregateDays(dayArray) {
  const totalSpend = dayArray.reduce((s,d)=>s+d.spend,0);
  const totalLeads = dayArray.reduce((s,d)=>s+d.leads,0);
  const totalClicks = dayArray.reduce((s,d)=>s+d.clicks,0);
  const totalImpr = dayArray.reduce((s,d)=>s+d.impressions,0);
  const totalOB = dayArray.reduce((s,d)=>s+d.outboundClicks,0);
  const totalBookings = dayArray.reduce((s,d)=>s+(d.dailyBookings||0),0);
  return {
    days: dayArray.length,
    startDate: dayArray[0].date,
    endDate: dayArray[dayArray.length-1].date,
    spend: totalSpend,
    leads: totalLeads,
    clicks: totalClicks,
    impressions: totalImpr,
    outboundClicks: totalOB,
    bookings: totalBookings,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    linkCPC: totalOB > 0 ? totalSpend / totalOB : 0,
    ctr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0,
    linkCTR: totalImpr > 0 ? (totalOB / totalImpr) * 100 : 0,
    frequency: dayArray.reduce((s,d)=>s+d.frequency,0) / dayArray.length,
    cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
    cpa: totalBookings > 0 ? totalSpend / totalBookings : 0,
    cpm: totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0,
  };
}

// Split cycle into 4 quarters of 7 days each (28-day cycle)
function aggregateToQuarters(dailyData) {
  if (!dailyData || !dailyData.length) return [];
  const qSize = 7; // 28-day cycle = 4 quarters of 7 days
  const quarters = [];
  for (let i = 0; i < 4; i++) {
    const slice = dailyData.slice(i * qSize, (i + 1) * qSize);
    if (!slice.length) continue;
    const agg = aggregateDays(slice);
    agg.label = `Q${i + 1}`;
    quarters.push(agg);
  }
  return quarters;
}

// Full cycle as a single aggregated row
function aggregateToFullCycle(dailyData) {
  if (!dailyData || !dailyData.length) return [];
  const agg = aggregateDays(dailyData);
  agg.label = 'Full Cycle';
  return [agg];
}

// Color coding helper for daily table cells
function metricCellClass(metric, value, cycle) {
  if (value === null || value === undefined || isNaN(value)) return '';
  const cpaGoal = cycle ? (cycle.cpaGoal || 0) : 0;
  const budget = cycle ? (cycle.monthlyBudget || cycle.budget || 0) : 0;
  const dailyBudget = budget > 0 ? budget / 30 : 0;
  const cplGoal = cycle && cycle.totalLeads > 0 && cycle.amountSpent > 0 ? cycle.amountSpent / cycle.totalLeads : 0;
  switch(metric) {
    case 'spend': return dailyBudget > 0 ? (value <= dailyBudget ? 'metric-cell-green' : value <= dailyBudget*1.2 ? 'metric-cell-yellow' : 'metric-cell-red') : '';
    case 'leads': return value > 0 ? 'metric-cell-green' : 'metric-cell-red';
    case 'cpl': return cplGoal > 0 ? (value <= cplGoal ? 'metric-cell-green' : value <= cplGoal*1.2 ? 'metric-cell-yellow' : 'metric-cell-red') : '';
    case 'linkCTR': return value >= 0.90 ? 'metric-cell-green' : value >= 0.60 ? 'metric-cell-yellow' : 'metric-cell-red';
    case 'cpc': return value <= 3 ? 'metric-cell-green' : value <= 5 ? 'metric-cell-yellow' : 'metric-cell-red';
    case 'frequency': return value <= 2.5 ? 'metric-cell-green' : value <= 3.5 ? 'metric-cell-yellow' : 'metric-cell-red';
    case 'cpa': return cpaGoal > 0 ? (value <= cpaGoal ? 'metric-cell-green' : value <= cpaGoal*1.2 ? 'metric-cell-yellow' : 'metric-cell-red') : '';
    case 'cpm': return value <= 15 ? 'metric-cell-green' : value <= 25 ? 'metric-cell-yellow' : 'metric-cell-red';
    default: return '';
  }
}

function renderMetaDailyTable(data, cycle) {
  const el = document.getElementById('meta-daily-table');
  if (!el || !data || !data.length) return;
  // Build rows newest first
  const rows = [...data].reverse();

  el.innerHTML = `
    <div class="overflow-x-auto table-scroll-hint rounded-lg border border-dark-600/50">
      <table class="w-full text-xs min-w-[380px] md:min-w-[900px]">
        <thead>
          <tr class="bg-dark-800/80 text-dark-400 text-[9px] uppercase tracking-wider">
            <th class="py-2 px-2 text-left font-medium">Date</th>
            <th class="py-2 px-2 text-right font-medium">Spend</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Freq</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Impr</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Clicks</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Link Clicks</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPC (Link)</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CTR (Link)</th>
            <th class="py-2 px-2 text-right font-medium">Leads</th>
            <th class="py-2 px-2 text-right font-medium">CPL</th>
            <th class="py-2 px-2 text-right font-medium">Cost/Result</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Bookings</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPA</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPM</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(d => {
            const dt = new Date(d.date + 'T12:00:00');
            const dateStr = (dt.getMonth()+1) + '/' + dt.getDate();
            const cpl = d.leads > 0 ? d.spend / d.leads : 0;
            const dailyBookings = d.dailyBookings || 0;
            const cpa = dailyBookings > 0 ? d.spend / dailyBookings : 0;
            const linkCPC = d.outboundClicks > 0 ? d.spend / d.outboundClicks : 0;
            const dayCpm = d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0;
            const cpr = d.costPerResult || 0;
            return `<tr class="border-b border-dark-700/30 hover:bg-dark-700/30">
              <td class="py-1.5 px-2 text-dark-200 whitespace-nowrap">${dateStr}</td>
              <td class="py-1.5 px-2 text-right text-dark-200">${fmtDollar(d.spend,2)}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('frequency', d.frequency, cycle)}">${d.frequency > 0 ? d.frequency.toFixed(2) : '—'}</td>
              <td class="py-1.5 px-2 text-right mobile-hide text-dark-200">${fmt(d.impressions)}</td>
              <td class="py-1.5 px-2 text-right mobile-hide text-dark-200">${fmt(d.clicks)}</td>
              <td class="py-1.5 px-2 text-right mobile-hide text-dark-200">${d.outboundClicks}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpc', linkCPC, cycle)}">${linkCPC > 0 ? fmtDollar(linkCPC,2) : '—'}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('linkCTR', d.linkCTR, cycle)}">${d.linkCTR > 0 ? d.linkCTR.toFixed(2)+'%' : '—'}</td>
              <td class="py-1.5 px-2 text-right ${metricCellClass('leads', d.leads, cycle)}">${d.leads}</td>
              <td class="py-1.5 px-2 text-right ${metricCellClass('cpl', cpl, cycle)}">${d.leads > 0 ? fmtDollar(cpl,2) : '—'}</td>
              <td class="py-1.5 px-2 text-right ${metricCellClass('cpl', cpr, cycle)}">${cpr > 0 ? fmtDollar(cpr,2) : '—'}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${dailyBookings > 0 ? 'metric-cell-green' : ''}">${dailyBookings}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpa', cpa, cycle)}">${cpa > 0 ? fmtDollar(cpa,0) : '—'}</td>
              <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpm', dayCpm, cycle)}">${dayCpm > 0 ? fmtDollar(dayCpm,2) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMetaSummary(data) {
  const totalSpend = data.reduce((s, d) => s + d.spend, 0);
  const totalLeads = data.reduce((s, d) => s + d.leads, 0);
  const totalClicks = data.reduce((s, d) => s + d.clicks, 0);
  const totalImpr = data.reduce((s, d) => s + d.impressions, 0);
  const totalOB = data.reduce((s, d) => s + d.outboundClicks, 0);
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const avgFreq = data.reduce((s,d)=>s+d.frequency,0) / data.length;
  const avgLinkCTR = totalImpr > 0 ? (totalOB / totalImpr) * 100 : 0;
  const avgCPM = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0;
  const summaryEl = document.getElementById('meta-daily-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Spend</div><div class="text-white font-bold text-sm">${fmtDollar(totalSpend,0)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Leads</div><div class="text-white font-bold text-sm">${fmt(totalLeads)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Avg CPL</div><div class="text-white font-bold text-sm">${fmtDollar(avgCPL,2)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Link CTR</div><div class="text-white font-bold text-sm ${ctrColor(avgLinkCTR)}">${avgLinkCTR.toFixed(2)}%</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Avg CPC</div><div class="text-white font-bold text-sm">${fmtDollar(totalClicks > 0 ? totalSpend/totalClicks : 0, 2)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">CPM</div><div class="text-white font-bold text-sm ${cpmColor(avgCPM)}">${fmtDollar(avgCPM,2)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Avg Freq</div><div class="text-white font-bold text-sm ${freqColor(avgFreq)}">${avgFreq.toFixed(2)}</div></div>
      <div class="bg-dark-800/50 rounded-lg p-2"><div class="text-dark-400 text-[9px] uppercase">Impressions</div><div class="text-white font-bold text-sm">${totalImpr > 1000 ? (totalImpr/1000).toFixed(1)+'K' : fmt(totalImpr)}</div></div>
    `;
  }
}

function switchMetaView(view) {
  metaCurrentView = view;
  renderMetaDailyChart('spend');
  renderMetaSummary(metaDailyData);
  if (view === 'daily') {
    renderMetaDailyTable(metaDailyData, metaCurrentCycle);
  } else if (view === 'quarters') {
    const qData = aggregateToQuarters(metaDailyData);
    renderMetaAggTable(qData, metaCurrentCycle);
  } else {
    const fData = aggregateToFullCycle(metaDailyData);
    renderMetaAggTable(fData, metaCurrentCycle);
  }
}

async function loadMetaDailyInsights(adAccountId, startDate, endDate, cycle, accountName) {
  metaViewMode = 'campaign'; // reset to campaign view on fresh load
  metaAdData = null;
  const section = document.getElementById('meta-daily-section');
  if (!section || !META_ACCESS_TOKEN) return;
  // Reset mode toggles
  document.querySelectorAll('.meta-mode-toggle').forEach(btn => {
    if (btn.dataset.mode === 'campaign') { btn.style.background = 'rgba(251,146,60,0.2)'; btn.style.color = '#fdba74'; btn.classList.add('active'); }
    else { btn.style.background = 'rgba(100,116,139,0.15)'; btn.style.color = '#94a3b8'; btn.classList.remove('active'); }
  });
  const viewToggles = document.getElementById('meta-view-toggles');
  if (viewToggles) viewToggles.style.display = 'flex';
  const chartContainer = document.querySelector('#meta-daily-section .chart-container');
  if (chartContainer) chartContainer.style.display = '';
  section.querySelector('h3').innerHTML = 'Ad Performance <span class="text-dark-400 text-xs font-normal ml-2"><span class="inline-block w-3 h-3 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mr-1" style="vertical-align:middle;"></span> Loading…</span>';
  const data = await fetchMetaDailyInsights(adAccountId, startDate, endDate);
  if (!data || data.length === 0) {
    section.querySelector('h3').innerHTML = 'Ad Performance <span class="text-dark-400 text-xs font-normal ml-2">No data available</span>';
    return;
  }

  // Enrich daily data with booking counts from lead data for accurate daily CPA
  if (accountName) {
    const cycleLeads = getLeadsForAccount(accountName, startDate, endDate);
    const bookedByDate = {};
    cycleLeads.forEach(l => {
      if (isBookedStatus(l.status) && l.date) {
        bookedByDate[l.date] = (bookedByDate[l.date] || 0) + 1;
      }
    });
    data.forEach(d => {
      d.dailyBookings = bookedByDate[d.date] || 0;
    });
  }

  metaDailyData = data;
  metaCurrentCycle = cycle || null;
  metaCurrentView = 'full';
  metaAccountName = accountName || '';
  section.querySelector('h3').textContent = 'Ad Performance';

  renderMetaSummary(data);
  renderMetaDailyChart('spend');
  // Default to Full Cycle view
  const fData = aggregateToFullCycle(data);
  renderMetaAggTable(fData, cycle);

  // View toggle (Day-by-Day / Cycle Quarters / Full Cycle)
  document.querySelectorAll('.meta-view-toggle').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.meta-view-toggle').forEach(b => { b.style.background = 'rgba(100,116,139,0.15)'; b.style.color = '#94a3b8'; b.classList.remove('active'); });
      btn.classList.add('active');
      btn.style.background = 'rgba(251,146,60,0.2)';
      btn.style.color = '#fdba74';
      switchMetaView(btn.dataset.view);
    };
  });
}

function renderMetaAggTable(aggData, cycle) {
  const el = document.getElementById('meta-daily-table');
  if (!el || !aggData || !aggData.length) return;
  el.innerHTML = `
    <div class="overflow-x-auto table-scroll-hint rounded-lg border border-dark-600/50">
      <table class="w-full text-xs min-w-[380px] md:min-w-[900px]">
        <thead>
          <tr class="bg-dark-800/80 text-dark-400 text-[9px] uppercase tracking-wider">
            <th class="py-2 px-2 text-left font-medium">Period</th>
            <th class="py-2 px-2 text-right font-medium">Spend</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Freq</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Impr</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Clicks</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Link Clicks</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPC (Link)</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CTR (Link)</th>
            <th class="py-2 px-2 text-right font-medium">Leads</th>
            <th class="py-2 px-2 text-right font-medium">CPL</th>
            <th class="py-2 px-2 text-right font-medium">Cost/Result</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">Bookings</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPA</th>
            <th class="py-2 px-2 text-right font-medium mobile-hide">CPM</th>
          </tr>
        </thead>
        <tbody>
          ${aggData.map(w => {
            const dateRange = w.startDate !== w.endDate ? `<div class="text-dark-400 text-[9px]">${w.startDate.slice(5)} → ${w.endDate.slice(5)}</div>` : '';
            const linkCPC = w.linkCPC || (w.outboundClicks > 0 ? w.spend / w.outboundClicks : 0);
            const aggCPR = w.costPerResult || (w.leads > 0 ? w.spend / w.leads : 0);
            return `<tr class="border-b border-dark-700/30 hover:bg-dark-700/30">
            <td class="py-1.5 px-2 text-dark-200 font-medium">${w.label}${dateRange}</td>
            <td class="py-1.5 px-2 text-right">${fmtDollar(w.spend,2)}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('frequency', w.frequency, cycle)}">${w.frequency.toFixed(2)}</td>
            <td class="py-1.5 px-2 text-right text-dark-200 mobile-hide">${fmt(w.impressions)}</td>
            <td class="py-1.5 px-2 text-right text-dark-200 mobile-hide">${fmt(w.clicks)}</td>
            <td class="py-1.5 px-2 text-right text-dark-200 mobile-hide">${fmt(w.outboundClicks)}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpc', linkCPC, cycle)}">${linkCPC > 0 ? fmtDollar(linkCPC,2) : '—'}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('linkCTR', w.linkCTR, cycle)}">${w.linkCTR.toFixed(2)}%</td>
            <td class="py-1.5 px-2 text-right ${metricCellClass('leads', w.leads, cycle)}">${w.leads}</td>
            <td class="py-1.5 px-2 text-right ${metricCellClass('cpl', w.cpl, cycle)}">${w.leads > 0 ? fmtDollar(w.cpl,2) : '—'}</td>
            <td class="py-1.5 px-2 text-right ${metricCellClass('cpl', aggCPR, cycle)}">${aggCPR > 0 ? fmtDollar(aggCPR,2) : '—'}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${w.bookings > 0 ? 'metric-cell-green' : ''}">${w.bookings || 0}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpa', w.cpa, cycle)}">${w.cpa > 0 ? fmtDollar(w.cpa,0) : '—'}</td>
            <td class="py-1.5 px-2 text-right mobile-hide ${metricCellClass('cpm', w.cpm, cycle)}">${w.cpm > 0 ? fmtDollar(w.cpm,2) : '—'}</td>
          </tr>`;}).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMetaDailyChart(metric) {
  if (!metaDailyData || !metaDailyData.length) return;
  const ctx = document.getElementById('chart-meta-daily');
  if (!ctx) return;
  if (metaDailyChart) metaDailyChart.destroy();

  let sourceData, labels, pointSize;
  if (metaCurrentView === 'quarters') {
    sourceData = aggregateToQuarters(metaDailyData);
    labels = sourceData.map(d => d.label);
    pointSize = 6;
  } else if (metaCurrentView === 'full') {
    // For full cycle, show the daily data on the chart anyway (table is the aggregate)
    sourceData = metaDailyData;
    labels = sourceData.map(d => { const dt = new Date(d.date + 'T12:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); });
    pointSize = 2;
  } else {
    sourceData = metaDailyData;
    labels = sourceData.map(d => { const dt = new Date(d.date + 'T12:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); });
    pointSize = 2;
  }

  // Chart always shows spend trend
  metaDailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Spend', data: sourceData.map(d => d.spend),
        borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.06)',
        borderWidth: 2.5, pointRadius: pointSize, pointHoverRadius: 7,
        pointBackgroundColor: '#3b82f6', pointBorderColor: '#1e293b', pointBorderWidth: 2,
        fill: true, tension: 0.4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', borderColor: 'rgba(100,116,139,0.2)', borderWidth: 1, cornerRadius: 8, padding: 10,
          titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
          callbacks: { label: (tip) => `Spend: $${tip.raw.toFixed(2)}` } }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9, family: 'Inter' }, maxRotation: 45 }, grid: { display: false } },
        y: { ticks: { color: '#64748b', callback: (v) => '$' + (v >= 1000 ? (v/1000).toFixed(1)+'K' : v.toFixed(0)) }, grid: { color: 'rgba(100,116,139,0.06)' } }
      }
    }
  });
}
