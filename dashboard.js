// ═══════════════════════════════════════════════
// RENDER: LEADERSHIP DASHBOARD
// ═══════════════════════════════════════════════
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  el.classList.remove('hidden');

  const active = allAccounts.filter(a => hasActiveCycle(a));
  const inactive = allAccounts.filter(a => !hasActiveCycle(a));
  const alerts = getAllAlerts();

  // ── Compute global stats ──
  let totalLeads = 0, totalSpent = 0, totalBooked = 0, totalMonthlyBudget = 0;
  let cpaValues = [], osaValues = [];
  let totalHealthy = 0, totalUnhealthy = 0, totalUnscored = 0;

  active.forEach(a => {
    const c = getActiveCycle(a.name, a.adAccountId);
    if (!c) return;
    if (c.totalLeads) totalLeads += c.totalLeads;
    if (c.amountSpent) totalSpent += c.amountSpent;
    if (c.bookedAppts) totalBooked += c.bookedAppts;
    if (c.cpa && c.cpa > 0) cpaValues.push(c.cpa);
    if (c.osaPct !== null) osaValues.push(c.osaPct);
    if (c.monthlyBudget) totalMonthlyBudget += c.monthlyBudget;
    const hs = getHealthScore(a, c);
    if (hs === null) totalUnscored++;
    else if (hs >= 60) totalHealthy++;
    else totalUnhealthy++;
  });

  const avgCPA = cpaValues.length ? cpaValues.reduce((a,b)=>a+b,0)/cpaValues.length : 0;
  const avgOSA = osaValues.length ? osaValues.reduce((a,b)=>a+b,0)/osaValues.length : 0;
  const totalBookRate = totalLeads > 0 ? (totalBooked / totalLeads * 100) : 0;
  const avgCPL = totalLeads > 0 ? totalSpent / totalLeads : 0;

  // ── Manager stats ──
  const managers = getManagers();
  function mgrStats(name) {
    const accts = getAccountsByManager(name).filter(a => hasActiveCycle(a));
    let leads=0, spent=0, booked=0, cpas=[], cpls=[], monthlyBudget=0, healthy=0, unhealthy=0, unscored=0;
    accts.forEach(a => {
      const c = getActiveCycle(a.name, a.adAccountId);
      if (!c) return;
      if (c.totalLeads) leads += c.totalLeads;
      if (c.amountSpent) spent += c.amountSpent;
      if (c.bookedAppts) booked += c.bookedAppts;
      if (c.cpa && c.cpa > 0) cpas.push(c.cpa);
      if (c.monthlyBudget) monthlyBudget += c.monthlyBudget;
      const hs = getHealthScore(a, c);
      if (hs === null) unscored++;
      else if (hs >= 60) healthy++;
      else unhealthy++;
    });
    const avgCPL = leads > 0 ? spent / leads : 0;
    const bookRate = leads > 0 ? (booked / leads * 100) : 0;
    return { leads, spent, booked, avgCPA: cpas.length ? cpas.reduce((a,b)=>a+b,0)/cpas.length : 0, avgCPL, bookRate, monthlyBudget, count: accts.length, healthy, unhealthy, unscored };
  }

  // ── Pod stats ──
  function podStats(accts) {
    let leads=0, spent=0, booked=0, cpas=[], monthlyBudget=0, healthy=0, unhealthy=0, unscored=0;
    accts.filter(a => hasActiveCycle(a)).forEach(a => {
      const c = getActiveCycle(a.name, a.adAccountId);
      if (!c) return;
      if (c.totalLeads) leads += c.totalLeads;
      if (c.amountSpent) spent += c.amountSpent;
      if (c.bookedAppts) booked += c.bookedAppts;
      if (c.cpa && c.cpa > 0) cpas.push(c.cpa);
      if (c.monthlyBudget) monthlyBudget += c.monthlyBudget;
      const hs = getHealthScore(a, c);
      if (hs === null) unscored++;
      else if (hs >= 60) healthy++;
      else unhealthy++;
    });
    const avgCPL = leads > 0 ? spent / leads : 0;
    const bookRate = leads > 0 ? (booked / leads * 100) : 0;
    return { leads, spent, booked, avgCPA: cpas.length ? cpas.reduce((a,b)=>a+b,0)/cpas.length : 0, avgCPL, bookRate, monthlyBudget, count: accts.filter(a => hasActiveCycle(a)).length, healthy, unhealthy, unscored };
  }
  const podNames = Object.keys(SHEETS);
  const podStatsMap = {};
  podNames.forEach(name => { podStatsMap[name] = podStats(getAccountsByPod(name)); });

  el.innerHTML = `
    <div class="mb-5 md:mb-8 fade-in">
      <div class="flex flex-wrap items-center gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-extrabold text-white tracking-tight">Command Center</h1>
          <p class="text-dark-300 text-sm mt-1 font-medium">${active.length} active accounts · ${inactive.length} inactive · ${allLeads.length} leads tracked</p>
        </div>
        <div class="ml-auto text-right">
          <div class="flex items-center gap-2 text-dark-300">
            <div class="w-2 h-2 rounded-full bg-emerald-400" style="animation:pulse 2s infinite"></div>
            <span class="text-xs font-medium">Live Data</span>
          </div>
          <p class="text-dark-400 text-[10px] mt-1">${new Date().toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}</p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-8">
      <!-- Active Accounts -->
      <div class="glass rounded-2xl p-3 md:p-5 kpi-card fade-in stagger-1" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-3">Accounts</div>
        <div class="text-2xl md:text-3xl font-extrabold text-white">${active.length} <span class="text-base md:text-lg text-dark-500 font-bold">active</span></div>
        <div class="text-xs text-dark-400 mt-1 font-medium">${inactive.length} inactive · ${allAccounts.length} total</div>
      </div>
      <!-- Health Ratio -->
      <div class="glass rounded-2xl p-3 md:p-5 kpi-card fade-in stagger-2" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-3">Account Health</div>
        <div class="flex items-center gap-4">
          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl md:text-3xl font-extrabold text-emerald-400">${totalHealthy}</span>
            <span class="text-[10px] text-emerald-400/70 font-semibold uppercase tracking-wide">healthy</span>
          </div>
          <span class="text-dark-600 text-lg font-bold">/</span>
          <div class="flex items-baseline gap-1.5">
            <span class="text-2xl md:text-3xl font-extrabold text-red-400">${totalUnhealthy}</span>
            <span class="text-[10px] text-red-400/70 font-semibold uppercase tracking-wide">unhealthy</span>
          </div>
        </div>
        <div class="flex items-center gap-3 mt-2">
          <div class="flex-1 h-2 rounded-full bg-dark-700 overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style="width:${(totalHealthy + totalUnhealthy) > 0 ? (totalHealthy / (totalHealthy + totalUnhealthy) * 100) : 0}%"></div>
          </div>
          <span class="text-[10px] text-dark-400 font-medium">${(totalHealthy + totalUnhealthy) > 0 ? Math.round(totalHealthy / (totalHealthy + totalUnhealthy) * 100) : 0}%</span>
        </div>
        ${totalUnscored > 0 ? `<div class="text-[10px] text-dark-500 mt-1">${totalUnscored} unscored</div>` : ''}
      </div>
      <!-- Book Rate -->
      <div class="glass rounded-2xl p-3 md:p-5 kpi-card fade-in stagger-3" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-3">Lead → Booked</div>
        <div class="text-2xl md:text-3xl font-extrabold text-white">${totalBookRate.toFixed(1)}<span class="text-base md:text-lg text-dark-400">%</span></div>
        <div class="text-xs text-dark-400 mt-1 font-medium">${fmt(totalBooked)} booked of ${fmt(totalLeads)} leads</div>
      </div>
      <!-- Combined Monthly Budget -->
      <div class="glass rounded-2xl p-3 md:p-5 kpi-card fade-in stagger-4" style="opacity:0">
        <div class="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-3">Monthly Budget</div>
        <div class="text-2xl md:text-3xl font-extrabold text-white">${fmtDollar(totalMonthlyBudget, 0)}</div>
        <div class="text-xs text-dark-400 mt-1 font-medium">across ${active.length} active accounts</div>
      </div>
    </div>

    <!-- Manager Cards -->
    <div class="section-title mb-4 fade-in stagger-2" style="opacity:0">Team Performance</div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-5 md:mb-8">
      ${managers.map((m, mi) => {
        const s = mgrStats(m);
        const _mc = MGR_COLORS[mi % MGR_COLORS.length];
        const _initColor = 'from-' + _mc.from + ' to-' + _mc.to;
        const healthPct = (s.healthy + s.unhealthy) > 0 ? Math.round(s.healthy / (s.healthy + s.unhealthy) * 100) : 0;
        return `
        <div class="glass rounded-2xl p-5 cursor-pointer hover:border-brand-500/20 transition-all fade-in stagger-${mi+3}" style="opacity:0" onclick="navigate('manager','${m}')">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${_initColor} flex items-center justify-center text-sm font-bold text-white shadow-lg">${m.charAt(0)}</div>
              <div>
                <h3 class="text-white font-bold text-[15px]">${m}</h3>
                <p class="text-dark-400 text-xs">${s.count} active accounts</p>
              </div>
            </div>
            <div class="text-right">
              <div class="flex items-center gap-2 justify-end">
                <span class="text-emerald-400 font-bold text-sm">${s.healthy} <span class="text-[9px] font-semibold text-emerald-400/60 uppercase">healthy</span></span>
                <span class="text-dark-600 text-xs">/</span>
                <span class="text-red-400 font-bold text-sm">${s.unhealthy} <span class="text-[9px] font-semibold text-red-400/60 uppercase">unhealthy</span></span>
              </div>
              <div class="w-full h-1.5 rounded-full bg-dark-700 overflow-hidden mt-1">
                <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style="width:${healthPct}%"></div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-3 border-t border-white/5">
            <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Book Rate</div><div class="text-white font-bold text-[15px] mt-0.5">${s.bookRate.toFixed(1)}<span class="text-[10px] text-dark-400">%</span></div><div class="text-[9px] text-dark-500">${fmt(s.booked)}/${fmt(s.leads)}</div></div>
            <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Leads</div><div class="text-white font-bold text-[15px] mt-0.5">${fmt(s.leads)}</div></div>
            <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Avg CPL</div><div class="text-white font-bold text-[15px] mt-0.5">${fmtDollar(s.avgCPL,2)}</div></div>
            <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Avg CPA</div><div class="text-${_mc.text} font-bold text-[15px] mt-0.5">${fmtDollar(s.avgCPA,2)}</div></div>
            <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Budget</div><div class="text-white font-bold text-[15px] mt-0.5">${fmtDollar(s.monthlyBudget,0)}</div></div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- Pod Overview (dynamic) -->
    <div class="section-title mb-4">Pod Overview</div>
    <div class="grid grid-cols-1 md:grid-cols-${Math.min(podNames.length, 3)} gap-3 md:gap-4 mb-5 md:mb-8">
      ${podNames.map((key, idx) => {
        const p = podStatsMap[key];
        const accent = POD_COLORS[idx % POD_COLORS.length];
        const label = key.replace(/ - RoofIgnite/i, '');
        const shortNum = label.replace(/Pod\s*/i, '');
        const podHealthPct = (p.healthy + p.unhealthy) > 0 ? Math.round(p.healthy / (p.healthy + p.unhealthy) * 100) : 0;
        return `
      <div class="glass rounded-2xl p-5 transition-all hover:border-${accent}-500/20">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-${accent}-500/10 flex items-center justify-center text-sm font-bold text-${accent}-400 border border-${accent}-500/15">${shortNum}</div>
            <div><h3 class="text-white font-bold">${label}</h3><p class="text-dark-400 text-xs">${p.count} active accounts</p></div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="flex items-center gap-2 justify-end">
                <span class="text-emerald-400 font-bold text-sm">${p.healthy} <span class="text-[9px] font-semibold text-emerald-400/60 uppercase">healthy</span></span>
                <span class="text-dark-600 text-xs">/</span>
                <span class="text-red-400 font-bold text-sm">${p.unhealthy} <span class="text-[9px] font-semibold text-red-400/60 uppercase">unhealthy</span></span>
              </div>
              <div class="w-full h-1.5 rounded-full bg-dark-700 overflow-hidden mt-1">
                <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style="width:${podHealthPct}%"></div>
              </div>
            </div>
            <button onclick="navigate('pod','${esc(key)}')" class="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-400 hover:bg-brand-500/10 transition-all">View →</button>
          </div>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-3 border-t border-white/5">
          <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Book Rate</div><div class="text-white font-bold text-[15px] mt-0.5">${p.bookRate.toFixed(1)}<span class="text-[10px] text-dark-400">%</span></div><div class="text-[9px] text-dark-500">${fmt(p.booked)}/${fmt(p.leads)}</div></div>
          <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Leads</div><div class="text-white font-bold text-[15px] mt-0.5">${fmt(p.leads)}</div></div>
          <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Avg CPL</div><div class="text-white font-bold text-[15px] mt-0.5">${fmtDollar(p.avgCPL,2)}</div></div>
          <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Avg CPA</div><div class="text-${accent}-400 font-bold text-[15px] mt-0.5">${fmtDollar(p.avgCPA,2)}</div></div>
          <div><div class="text-dark-400 text-[10px] uppercase tracking-wider">Budget</div><div class="text-white font-bold text-[15px] mt-0.5">${fmtDollar(p.monthlyBudget,0)}</div></div>
        </div>
      </div>`;
      }).join('')}
    </div>

    <!-- Health Scorecard -->
    <div class="glass rounded-2xl p-5 mb-5 md:mb-8">
      <div class="flex items-center justify-between mb-4">
        <div class="section-title">Account Health Scores</div>
        <div class="text-dark-400 text-[10px] tracking-wide flex items-center gap-4">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span>80+</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-yellow-400"></span>60–79</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-400"></span>&lt;60</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 health-scroll" id="health-scoreboard"></div>
    </div>

    <!-- Attention Required (detailed watchlist) -->
    <div class="glass rounded-2xl p-5 mb-5 md:mb-8" style="border: 1px solid rgba(239,68,68,0.18); background: linear-gradient(135deg, rgba(239,68,68,0.03), rgba(15,23,42,0.8));">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
            <span class="w-2.5 h-2.5 rounded-full bg-red-500 pulse"></span>
          </div>
          <div>
            <h3 class="text-white font-bold">Attention Required</h3>
            <span class="text-dark-400 text-xs" id="alert-count-label"></span>
          </div>
        </div>
      </div>
      <div id="attention-table-wrap"></div>
    </div>

    <!-- Top Performers + Needs Attention -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-5 md:mb-8">
      <div class="glass rounded-2xl p-5" style="border: 1px solid rgba(34,197,94,0.12);">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
          <h3 class="text-white font-bold">On Track</h3>
        </div>
        <div class="space-y-1" id="top-performers"></div>
      </div>
      <div class="glass rounded-2xl p-5" style="border: 1px solid rgba(239,68,68,0.12);">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center"><svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg></div>
          <h3 class="text-white font-bold">Off Track</h3>
        </div>
        <div class="space-y-1" id="needs-attention"></div>
      </div>
    </div>

    <!-- Distribution Charts -->
    <div class="section-title mb-4">Portfolio Analytics</div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="glass rounded-2xl p-5">
        <h3 class="text-white font-bold text-sm mb-3 flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-brand-400"></div>
          CPA Distribution
        </h3>
        <div class="chart-container"><canvas id="chart-cpa-dist"></canvas></div>
      </div>
      <div class="glass rounded-2xl p-5">
        <h3 class="text-white font-bold text-sm mb-3 flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-blue-400"></div>
          OSA Rate by Account
        </h3>
        <div class="chart-container"><canvas id="chart-osa"></canvas></div>
      </div>
    </div>
  `;

  // On track: estBooked >= 80% of goal
  const onTrackAccts = active.map(a => {
    const c = getActiveCycle(a.name, a.adAccountId);
    return { account: a, cycle: c };
  }).filter(x => x.cycle && isOnTrack(x.cycle) === true)
    .sort((a,b) => {
      const aRatio = a.cycle.estBookedAppts / a.cycle.bookedGoal;
      const bRatio = b.cycle.estBookedAppts / b.cycle.bookedGoal;
      return bRatio - aRatio;
    }).slice(0, 5);

  document.getElementById('top-performers').innerHTML = onTrackAccts.map(p => `
    <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-dark-700 cursor-pointer" onclick="navigate('account',{name:'${esc(p.account.name)}',adAccountId:'${p.account.adAccountId}'})">
      <div>
        <div class="text-white text-sm font-medium">${p.account.name}</div>
        <div class="text-dark-400 text-xs">${p.account.manager}</div>
      </div>
      <div class="text-right">
        <div class="badge badge-green">Est. ${fmt(p.cycle.estBookedAppts)} / ${fmt(p.cycle.bookedGoal)} goal</div>
      </div>
    </div>
  `).join('') || '<div class="text-dark-400 text-sm text-center py-4">No data yet</div>';

  // Detailed attention table
  const attnWrap = document.getElementById('attention-table-wrap');
  const attnLabel = document.getElementById('alert-count-label');
  if (attnWrap) {
    const dangerCount = alerts.reduce((s,a) => s + a.issues.filter(i=>i.type==='danger').length, 0);
    const warnCount = alerts.reduce((s,a) => s + a.issues.filter(i=>i.type==='warning').length, 0);
    attnLabel.textContent = `${dangerCount} critical · ${warnCount} warnings across ${alerts.length} accounts`;
    if (alerts.length === 0) {
      attnWrap.innerHTML = '<div class="text-dark-400 text-sm text-center py-4">✓ All accounts healthy — no alerts</div>';
    } else {
      attnWrap.innerHTML = `<div style="overflow-x:auto;" class="table-scroll-hint"><table class="w-full text-sm">
        <thead><tr class="text-dark-400 text-[10px] uppercase tracking-wider border-b border-dark-600">
          <th class="text-left py-2 px-2">Account</th><th class="text-left py-2 px-2">Issues</th><th class="text-center py-2 px-2">Current</th><th class="text-center py-2 px-2">Threshold</th>
        </tr></thead><tbody>${alerts.map(a => a.issues.map((iss, idx) => `
          <tr class="table-row border-b border-dark-700 ${idx === 0 ? '' : 'border-t-0'}" style="cursor:pointer;" onclick="navigate('account',{name:'${esc(a.account.name)}',adAccountId:'${a.account.adAccountId}'})">
            <td class="py-2 px-2 ${idx === 0 ? 'text-white font-medium' : 'text-transparent'}" style="${idx > 0 ? 'font-size:0;' : ''}">${idx === 0 ? a.account.name : ''}</td>
            <td class="py-2 px-2"><span class="badge ${iss.type === 'danger' ? 'badge-red' : 'badge-yellow'}" style="font-size:10px;">${iss.type === 'danger' ? '●' : '▲'}</span> <span class="${iss.type === 'danger' ? 'text-red-400' : 'text-yellow-400'} text-xs">${iss.msg}</span></td>
            <td class="py-2 px-2 text-center text-white text-xs">${iss.current || '—'}</td>
            <td class="py-2 px-2 text-center text-dark-300 text-xs">${iss.threshold || '—'}</td>
          </tr>`).join('')).join('')}</tbody></table></div>`;
    }
  }

  const attention = alerts.slice(0, 5);
  document.getElementById('needs-attention').innerHTML = attention.map(a => `
    <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-dark-700 cursor-pointer" onclick="navigate('account',{name:'${esc(a.account.name)}',adAccountId:'${a.account.adAccountId}'})">
      <div>
        <div class="text-white text-sm font-medium">${a.account.name}</div>
        <div class="text-dark-400 text-xs">${a.issues[0].msg}</div>
      </div>
      <span class="badge ${a.issues[0].type === 'danger' ? 'badge-red' : 'badge-yellow'}">${a.issues[0].type === 'danger' ? 'Critical' : 'Warning'}</span>
    </div>
  `).join('') || '<div class="text-dark-400 text-sm text-center py-4">All clear!</div>';

  // Render health scoreboard
  const healthBoard = document.getElementById('health-scoreboard');
  if (healthBoard) {
    const scored = active.map(a => {
      const c = getActiveCycle(a.name, a.adAccountId);
      return { account: a, cycle: c, score: getHealthScore(a, c) };
    }).filter(x => x.score !== null).sort((a,b) => a.score - b.score);

    healthBoard.innerHTML = scored.map(s => {
      const col = healthScoreColor(s.score);
      return `<div class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-dark-700 transition-all" onclick="navigate('account',{name:'${esc(s.account.name)}',adAccountId:'${s.account.adAccountId}'})" title="${s.account.name}: ${s.score}/100">
        <div class="health-ring" style="background:${col.bg};color:${col.text};">${s.score}</div>
        <div>
          <div class="text-white text-xs font-medium" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.account.name}</div>
          <div class="text-dark-400 text-[10px]">${s.account.manager}</div>
        </div>
      </div>`;
    }).join('') || '<div class="text-dark-400 text-sm">No scored accounts yet</div>';
  }

  renderCPADistChart();
  renderOSAChart();
}

function renderCPADistChart() {
  const ctx = document.getElementById('chart-cpa-dist');
  if (!ctx) return;
  const active = allAccounts.filter(a => hasActiveCycle(a));
  const data = active.map(a => {
    const c = getActiveCycle(a.name, a.adAccountId);
    return c && c.cpa > 0 ? { name: a.name, cpa: c.cpa, goal: a.cpaGoal || c.cpaGoal } : null;
  }).filter(Boolean).sort((a,b) => a.cpa - b.cpa).slice(0, 20);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.name.length > 15 ? d.name.substring(0,15)+'...' : d.name),
      datasets: [{ label: 'CPA', data: data.map(d => d.cpa),
        backgroundColor: data.map(d => d.goal && d.cpa > d.goal ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)'),
        borderColor: data.map(d => d.goal && d.cpa > d.goal ? 'rgba(239,68,68,0.8)' : 'rgba(34,197,94,0.8)'),
        borderWidth: 1, borderRadius: 6, borderSkipped: false }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(148,163,184,0.15)', borderWidth: 1, cornerRadius: 8, padding: 10 } },
      scales: { x: { ticks: { color: '#64748b', font: { size: 9, family: 'Inter' } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', font: { family: 'Inter' }, callback: v => '$'+v }, grid: { color: 'rgba(100,116,139,0.06)' } } }
    }
  });
}

function renderOSAChart() {
  const ctx = document.getElementById('chart-osa');
  if (!ctx) return;
  const active = allAccounts.filter(a => hasActiveCycle(a));
  const data = active.map(a => {
    const c = getActiveCycle(a.name, a.adAccountId);
    return c && c.osaPct !== null ? { name: a.name, osa: c.osaPct } : null;
  }).filter(Boolean).sort((a,b) => a.osa - b.osa).slice(0, 20);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.name.length > 15 ? d.name.substring(0,15)+'...' : d.name),
      datasets: [{ label: 'OSA %', data: data.map(d => d.osa),
        backgroundColor: data.map(d => d.osa < 20 ? 'rgba(34,197,94,0.55)' : d.osa < 25 ? 'rgba(250,204,21,0.55)' : 'rgba(239,68,68,0.55)'),
        borderColor: data.map(d => d.osa < 20 ? 'rgba(34,197,94,0.8)' : d.osa < 25 ? 'rgba(250,204,21,0.8)' : 'rgba(239,68,68,0.8)'),
        borderWidth: 1, borderRadius: 6, borderSkipped: false }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#f1f5f9', bodyColor: '#cbd5e1', borderColor: 'rgba(100,116,139,0.2)', borderWidth: 1, cornerRadius: 8, padding: 10,
          titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' },
          callbacks: { label: tip => `OSA: ${tip.raw.toFixed(1)}%` } } },
      scales: { x: { ticks: { color: '#64748b', callback: v => v+'%' }, grid: { color: 'rgba(100,116,139,0.06)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10, family: 'Inter' } }, grid: { display: false } } }
    }
  });
}

// ═══════════════════════════════════════════════
// RENDER: MANAGER VIEW (with alerts)
// ═══════════════════════════════════════════════
function renderManagerView(mgrName) {
  const el = document.getElementById('view-manager');
  el.classList.remove('hidden');

  const accounts = getAccountsByManager(mgrName);
  const active = accounts.filter(a => hasActiveCycle(a));
  const inactive = accounts.filter(a => !hasActiveCycle(a));
  const alerts = getAlertAccountsForManager(mgrName);

  const _mgrIdx = getManagers().indexOf(mgrName);
  const _mc2 = MGR_COLORS[(_mgrIdx >= 0 ? _mgrIdx : 0) % MGR_COLORS.length];
  const _mgrColor = 'from-' + _mc2.from + ' to-' + _mc2.to;
  el.innerHTML = `
    <div class="mb-5 md:mb-8 fade-in">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-gradient-to-br ${_mgrColor} flex items-center justify-center text-xl font-bold text-white shadow-lg">${mgrName.charAt(0)}</div>
          <div>
            <h1 class="text-2xl font-extrabold text-white">${mgrName}</h1>
            <p class="text-dark-300 text-sm mt-1">${active.length} active accounts · ${inactive.length} inactive</p>
          </div>
        </div>
        <img src="data:image/png;base64,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" alt="RoofIgnite" class="h-8 w-auto opacity-40 mobile-hide" />
      </div>
    </div>

    ${alerts.length > 0 ? `
    <div class="glass rounded-2xl p-5 mb-6" style="border:1px solid rgba(239,68,68,0.18);background:linear-gradient(135deg,rgba(239,68,68,0.03),rgba(15,23,42,0.8));">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center"><span class="w-2 h-2 rounded-full bg-red-500 pulse"></span></div>
        <h3 class="text-white font-bold">Off Track Accounts</h3>
        <span class="badge badge-red">${alerts.length}</span>
      </div>
      <div class="space-y-2">
        ${alerts.map(a => `
          <div class="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-dark-700/50 cursor-pointer transition-all" onclick="navigate('account',{name:'${esc(a.account.name)}',adAccountId:'${a.account.adAccountId}'})">
            <div class="flex items-center gap-3">
              <div class="text-white font-medium text-sm">${a.account.name}</div>
              <span class="badge badge-blue text-[10px]">${a.active.cycle}</span>
            </div>
            <div class="flex flex-wrap gap-1 justify-end">
              ${a.issues.map(i => `<span class="badge ${i.type==='danger'?'badge-red':'badge-yellow'} text-[10px]">${i.msg}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>` : `
    <div class="glass rounded-2xl p-4 mb-6" style="border:1px solid rgba(34,197,94,0.15);">
      <div class="flex items-center gap-3 text-green-400">
        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>
        <span class="text-sm font-medium">All accounts within KPI targets</span>
      </div>
    </div>`}

    ${renderAccountTable(active, inactive, mgrName)}
  `;
}

// ═══════════════════════════════════════════════
// RENDER: POD VIEW
// ═══════════════════════════════════════════════
function renderPodView(podName) {
  const el = document.getElementById('view-pod');
  el.classList.remove('hidden');

  const accounts = getAccountsByPod(podName);
  const active = accounts.filter(a => hasActiveCycle(a));
  const inactive = accounts.filter(a => !hasActiveCycle(a));
  const podLabel = podName.replace(' - RoofIgnite', '');

  const podNum = podLabel.replace(/[^0-9]/g,'');
  const podIdx = Object.keys(SHEETS).indexOf(podName);
  const podAccent = POD_COLORS[(podIdx >= 0 ? podIdx : 0) % POD_COLORS.length];
  el.innerHTML = `
    <div class="mb-5 md:mb-8 fade-in">
      <div class="flex items-center gap-4">
        <div class="w-12 h-12 rounded-2xl bg-${podAccent}-500/10 flex items-center justify-center text-xl font-bold text-${podAccent}-400 border border-${podAccent}-500/15">${podNum || '?'}</div>
        <div>
          <h1 class="text-2xl font-extrabold text-white">${podLabel}</h1>
          <p class="text-dark-300 text-sm mt-1">${active.length} active accounts · ${inactive.length} inactive</p>
        </div>
      </div>
    </div>
    ${renderAccountTable(active, inactive)}
  `;
}

function renderAccountTable(active, inactive, mgrName) {
  // Sort active accounts by HP: worst (lowest) first, nulls at the end
  const sortedActive = [...active].sort((a, b) => {
    const ca = getActiveCycle(a.name, a.adAccountId);
    const cb = getActiveCycle(b.name, b.adAccountId);
    const ha = getHealthScore(a, ca);
    const hb = getHealthScore(b, cb);
    if (ha === null && hb === null) return a.name.localeCompare(b.name);
    if (ha === null) return 1;
    if (hb === null) return -1;
    return ha - hb;
  });

  return `
    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto table-scroll-hint">
        <table class="w-full text-sm min-w-[500px] md:min-w-[1200px]">
          <thead>
            <tr class="border-b border-dark-600 text-dark-400 text-[10px] uppercase tracking-wider" style="background:rgba(15,23,42,0.5);">
              <th class="text-center py-3 px-3 font-medium">HP</th>
              <th class="text-left py-3 px-3 font-medium">Account</th>
              <th class="text-center py-3 px-3 font-medium">FTG</th>
              <th class="text-left py-3 px-3 font-medium mobile-hide">Cycle</th>
              <th class="text-right py-3 px-3 font-medium">Leads</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">L2B</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">OSA%</th>
              <th class="text-right py-3 px-3 font-medium">Bkd</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">Est.Bkd</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">Goal</th>
              <th class="text-right py-3 px-3 font-medium">CPA</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">CPA Goal</th>
              <th class="text-right py-3 px-3 font-medium">Spent</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">Pace</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">CTR</th>
              <th class="text-right py-3 px-3 font-medium mobile-hide">Freq</th>
              <th class="text-center py-3 px-3 font-medium mobile-hide">Track</th>
            </tr>
          </thead>
          <tbody>
            ${sortedActive.map(a => {
              const c = getActiveCycle(a.name, a.adAccountId);
              const cpaGoal = a.cpaGoal || (c && c.cpaGoal);
              const hs = getHealthScore(a, c);
              const hc = healthScoreColor(hs);
              const fs = getFatigueScore(a, c);
              const fc = fatigueScoreColor(fs);
              const l2b = getLeadToBookedRate(a.name, 45);
              const bkPace = c ? getBookingPacing(c) : null;
              return `
                <tr class="table-row border-b border-dark-700/50 cursor-pointer" onclick="navigate('account',{name:'${esc(a.name)}',adAccountId:'${a.adAccountId}'})">
                  <td class="py-3 px-3 text-center">${hs !== null ? `<span class="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold" style="background:${hc.bg};color:${hc.text};">${hs}</span>` : '<span class="text-dark-500 text-xs">—</span>'}</td>
                  <td class="py-3 px-3">
                    <div class="text-white font-medium">${a.name}</div>
                    <div class="text-dark-400 text-xs">${a.manager}</div>
                  </td>
                  <td class="py-3 px-3 text-center">${fs !== null ? `<span class="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold" style="background:${fc.bg};color:${fc.text};">${fs}</span>` : '<span class="text-dark-500 text-xs">—</span>'}</td>
                  <td class="py-3 px-3 text-dark-300 text-xs mobile-hide">${c ? c.cycle : '—'}</td>
                  <td class="py-3 px-3 text-right text-white">${c ? fmt(c.totalLeads) : '—'}</td>
                  <td class="py-3 px-3 text-right mobile-hide">${l2b !== null ? `<span class="${l2b >= 0.375 ? 'metric-good' : 'metric-warn'}">${(l2b*100).toFixed(0)}%</span>` : '<span class="text-dark-500">—</span>'}</td>
                  <td class="py-3 px-3 text-right mobile-hide"><span class="${c ? osaColor(c.osaPct) : 'text-dark-400'}">${c ? fmtPct(c.osaPct) : '—'}</span></td>
                  <td class="py-3 px-3 text-right text-green-400 font-semibold">${c ? fmt(c.bookedAppts) : '—'}</td>
                  <td class="py-3 px-3 text-right text-white mobile-hide">${c ? fmt(c.estBookedAppts) : '—'}</td>
                  <td class="py-3 px-3 text-right text-dark-400 mobile-hide">${c ? fmt(c.bookedGoal) : '—'}</td>
                  <td class="py-3 px-3 text-right"><span class="${c ? cpaColor(c.cpa, cpaGoal) : 'text-dark-400'}">${c ? fmtDollar(c.cpa,2) : '—'}</span></td>
                  <td class="py-3 px-3 text-right text-dark-400 mobile-hide">${cpaGoal ? fmtDollar(cpaGoal,2) : '—'}</td>
                  <td class="py-3 px-3 text-right text-white">${c ? fmtDollar(c.amountSpent,0) : '—'}</td>
                  <td class="py-3 px-3 text-right mobile-hide">${bkPace ? `<span class="text-xs font-medium" style="color:${bookingPaceColor(bkPace.status)}">${bkPace.status === 'behind' ? '▲' : '●'} ${Math.round(bkPace.pctOfGoal*100)}%</span>` : '<span class="text-dark-500">—</span>'}</td>
                  <td class="py-3 px-3 text-right mobile-hide"><span class="${c ? ctrColor(c.linkCTR) : 'text-dark-400'}">${c && c.linkCTR ? fmtPctDec(c.linkCTR) : '—'}</span></td>
                  <td class="py-3 px-3 text-right mobile-hide"><span class="${c ? freqColor(c.frequency) : 'text-dark-400'}">${c && c.frequency ? c.frequency.toFixed(1) : '—'}</span></td>
                  <td class="py-3 px-3 text-center mobile-hide">${onTrackBadge(c)}</td>
                </tr>
              `;
            }).join('')}
            ${inactive.map(a => `
              <tr class="table-row border-b border-dark-700/50 opacity-40 cursor-pointer" onclick="navigate('account',{name:'${esc(a.name)}',adAccountId:'${a.adAccountId}'})">
                <td class="py-3 px-3 text-center"><span class="text-dark-500 text-xs">—</span></td>
                <td class="py-3 px-3"><div class="text-dark-300 font-medium">${a.name} <span class="badge badge-gray ml-1">INACTIVE</span></div><div class="text-dark-500 text-xs">${a.manager}</div></td>
                <td class="py-3 px-3 text-center"><span class="text-dark-500 text-xs">—</span></td>
                <td class="py-3 px-3 text-dark-500 text-xs" colspan="14">No active cycle</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════
