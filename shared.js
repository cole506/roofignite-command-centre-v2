// ═══════════════════════════════════════════════
// DATA LAYER — Google Sheets Integration
// ═══════════════════════════════════════════════
const SHEET_ID = CONFIG.SHEET_ID;
const SHEETS = CONFIG.SHEETS;
const LEAD_SHEETS = CONFIG.LEAD_SHEETS;

// ═══════════════════════════════════════════════
// META API — Paste your long-lived access token here
// ═══════════════════════════════════════════════
const META_ACCESS_TOKEN = CONFIG.META_ACCESS_TOKEN;
const META_API_VERSION = CONFIG.META_API_VERSION;
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Cache for Meta daily insights per ad account
const metaDailyCache = {};
// Ad-level view state
let metaViewMode = 'campaign'; // 'campaign' or 'ad'
let metaAdData = null;
const metaAdCache = {};
const metaCreativeCache = {};
const metaAdStatusCache = {};
const metaCampaignCache = {};
const metaAdSetCache = {};
let metaAdFilters = { campaignId: null, adsetId: null, dateStart: null, dateEnd: null };

async function fetchMetaDailyInsights(adAccountId, dateStart, dateEnd) {
  if (!META_ACCESS_TOKEN || !adAccountId) return null;
  const cacheKey = `${adAccountId}_${dateStart}_${dateEnd}`;
  if (metaDailyCache[cacheKey]) return metaDailyCache[cacheKey];
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  try {
    let allData = [];
    let url = `${META_BASE}/${actId}/insights?fields=spend,impressions,clicks,actions,cost_per_action_type,cpc,cpm,ctr,frequency,outbound_clicks&time_range={"since":"${dateStart}","until":"${dateEnd}"}&time_increment=1&level=account&limit=100&access_token=${META_ACCESS_TOKEN}`;
    // Paginate through all results
    while (url) {
      const resp = await fetch(url);
      if (!resp.ok) break;
      const json = await resp.json();
      if (json.data) allData = allData.concat(json.data);
      url = (json.paging && json.paging.next) ? json.paging.next : null;
    }
    const days = allData.map(d => {
      const leads = (d.actions || []).find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead');
      const obClicks = (d.outbound_clicks || []).find(a => a.action_type === 'outbound_click');
      const outboundClicks = obClicks ? parseInt(obClicks.value || 0) : 0;
      const impressions = parseInt(d.impressions || 0);
      const cprEntry = (d.cost_per_action_type || []).find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead');
      return {
        date: d.date_start,
        spend: parseFloat(d.spend || 0),
        impressions,
        clicks: parseInt(d.clicks || 0),
        leads: leads ? parseInt(leads.value || 0) : 0,
        costPerResult: cprEntry ? parseFloat(cprEntry.value || 0) : 0,
        cpc: parseFloat(d.cpc || 0),
        cpm: parseFloat(d.cpm || 0),
        ctr: parseFloat(d.ctr || 0),
        frequency: parseFloat(d.frequency || 0),
        outboundClicks,
        linkCTR: impressions > 0 ? (outboundClicks / impressions) * 100 : 0,
      };
    });
    metaDailyCache[cacheKey] = days;
    return days;
  } catch (e) {
    console.warn('Meta API error:', e);
    return null;
  }
}

// ═══ Ad-Level Insights (Individual Ads) ═══

async function fetchMetaAdInsights(adAccountId, dateStart, dateEnd, filters) {
  if (!META_ACCESS_TOKEN || !adAccountId) return null;
  const f = filters || {};
  const cacheKey = `ad_${adAccountId}_${dateStart}_${dateEnd}_${f.campaignId||''}_${f.adsetId||''}`;
  if (metaAdCache[cacheKey]) return metaAdCache[cacheKey];
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  try {
    // Build dynamic filtering — only show active campaigns/ad sets
    const filterArr = [];
    if (f.campaignId) {
      filterArr.push({field:'campaign.id',operator:'IN',value:[f.campaignId]});
    } else {
      filterArr.push({field:'campaign.name',operator:'CONTAIN',value:'B2C'});
    }
    if (f.adsetId) {
      filterArr.push({field:'adset.id',operator:'IN',value:[f.adsetId]});
    }
    filterArr.push({field:'campaign.effective_status',operator:'IN',value:['ACTIVE']});
    filterArr.push({field:'adset.effective_status',operator:'IN',value:['ACTIVE']});
    let allData = [];
    let url = `${META_BASE}/${actId}/insights?fields=ad_id,ad_name,spend,impressions,clicks,actions,cost_per_action_type,cpc,cpm,ctr,frequency,outbound_clicks&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=ad&limit=100&filtering=${encodeURIComponent(JSON.stringify(filterArr))}&access_token=${META_ACCESS_TOKEN}`;
    while (url) {
      const resp = await fetch(url);
      if (!resp.ok) break;
      const json = await resp.json();
      if (json.data) allData = allData.concat(json.data);
      url = (json.paging && json.paging.next) ? json.paging.next : null;
    }
    const ads = allData.map(d => {
      const leads = (d.actions || []).find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead');
      const obClicks = (d.outbound_clicks || []).find(a => a.action_type === 'outbound_click');
      const outboundClicks = obClicks ? parseInt(obClicks.value || 0) : 0;
      const impressions = parseInt(d.impressions || 0);
      const spend = parseFloat(d.spend || 0);
      const leadCount = leads ? parseInt(leads.value || 0) : 0;
      const cprEntry = (d.cost_per_action_type || []).find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead');
      return {
        adId: d.ad_id,
        adName: d.ad_name || '(unnamed)',
        spend, impressions,
        clicks: parseInt(d.clicks || 0),
        leads: leadCount,
        cpl: leadCount > 0 ? spend / leadCount : 0,
        costPerResult: cprEntry ? parseFloat(cprEntry.value || 0) : 0,
        cpc: outboundClicks > 0 ? spend / outboundClicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        ctr: impressions > 0 ? (outboundClicks / impressions) * 100 : 0,
        frequency: parseFloat(d.frequency || 0),
        outboundClicks,
        thumbnail: null,
        status: null,
      };
    }).sort((a, b) => b.spend - a.spend);
    metaAdCache[cacheKey] = ads;
    return ads;
  } catch (e) {
    console.warn('Meta Ad Insights API error:', e);
    return null;
  }
}

async function fetchAdCreativesAndStatuses(ads) {
  if (!ads || !ads.length) return;
  const toFetch = ads.filter(a => a.adId && (!metaCreativeCache[a.adId] || !metaAdStatusCache[a.adId]));
  for (let i = 0; i < toFetch.length; i += 10) {
    const batch = toFetch.slice(i, i + 10);
    await Promise.all(batch.map(async (ad) => {
      try {
        const url = `${META_BASE}/${ad.adId}?fields=creative{thumbnail_url,image_url,body,title,link_url,call_to_action_type,asset_feed_spec},effective_status&access_token=${META_ACCESS_TOKEN}`;
        const resp = await fetch(url);
        if (!resp.ok) return;
        const json = await resp.json();
        const creative = json.creative || {};
        // Collect all primary texts: from asset_feed_spec.bodies (dynamic creative) or single body
        const afs = creative.asset_feed_spec || {};
        const bodies = [];
        if (afs.bodies && afs.bodies.length) {
          afs.bodies.forEach(b => { if (b.text) bodies.push(b.text); });
        }
        if (!bodies.length && creative.body) bodies.push(creative.body);
        // Collect all titles/headlines
        const titles = [];
        if (afs.titles && afs.titles.length) {
          afs.titles.forEach(t => { if (t.text) titles.push(t.text); });
        }
        if (!titles.length && creative.title) titles.push(creative.title);
        // Collect all descriptions
        const descriptions = [];
        if (afs.descriptions && afs.descriptions.length) {
          afs.descriptions.forEach(d => { if (d.text) descriptions.push(d.text); });
        }
        metaCreativeCache[ad.adId] = {
          image: creative.image_url || creative.thumbnail_url || null,
          bodies: bodies,
          titles: titles,
          descriptions: descriptions,
          linkUrl: creative.link_url || '',
          cta: (creative.call_to_action_type || '').replace(/_/g, ' '),
        };
        metaAdStatusCache[ad.adId] = json.effective_status || 'UNKNOWN';
      } catch (e) { console.warn('Creative/status fetch failed for ad ' + ad.adId, e); }
    }));
  }
  ads.forEach(a => {
    const cached = metaCreativeCache[a.adId];
    if (cached) {
      a.thumbnail = typeof cached === 'string' ? cached : cached.image;
      a.adCopy = typeof cached === 'object' ? cached : null;
    }
    if (metaAdStatusCache[a.adId]) a.status = metaAdStatusCache[a.adId];
  });
}

async function fetchMetaCampaigns(adAccountId) {
  const cacheKey = `camps_${adAccountId}`;
  if (metaCampaignCache[cacheKey]) return metaCampaignCache[cacheKey];
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  try {
    let all = [];
    let url = `${META_BASE}/${actId}/campaigns?fields=id,name,effective_status&filtering=${encodeURIComponent(JSON.stringify([{field:'name',operator:'CONTAIN',value:'B2C'},{field:'effective_status',operator:'IN',value:['ACTIVE']}]))}&limit=100&access_token=${META_ACCESS_TOKEN}`;
    while (url) {
      const resp = await fetch(url);
      if (!resp.ok) break;
      const json = await resp.json();
      if (json.data) all = all.concat(json.data);
      url = (json.paging && json.paging.next) ? json.paging.next : null;
    }
    metaCampaignCache[cacheKey] = all;
    return all;
  } catch (e) { console.warn('Campaigns fetch error:', e); return []; }
}

async function fetchMetaAdSets(adAccountId, campaignId) {
  const cacheKey = `adsets_${adAccountId}_${campaignId}`;
  if (metaAdSetCache[cacheKey]) return metaAdSetCache[cacheKey];
  const actId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  try {
    let all = [];
    let url = `${META_BASE}/${actId}/adsets?fields=id,name,effective_status&filtering=${encodeURIComponent(JSON.stringify([{field:'campaign.id',operator:'IN',value:[campaignId]},{field:'effective_status',operator:'IN',value:['ACTIVE']}]))}&limit=100&access_token=${META_ACCESS_TOKEN}`;
    while (url) {
      const resp = await fetch(url);
      if (!resp.ok) break;
      const json = await resp.json();
      if (json.data) all = all.concat(json.data);
      url = (json.paging && json.paging.next) ? json.paging.next : null;
    }
    metaAdSetCache[cacheKey] = all;
    return all;
  } catch (e) { console.warn('AdSets fetch error:', e); return []; }
}

async function toggleAdStatus(adId, currentStatus) {
  const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
  const label = newStatus === 'PAUSED' ? 'Pause' : 'Activate';
  if (!confirm(`${label} this ad?`)) return;
  try {
    // Route through Apps Script backend to avoid CORS
    const result = await writeToSheet('toggleAdStatus', { adId, status: newStatus });
    if (!result.ok) {
      showToast('Failed: ' + (result.error || 'Unknown error'), 'error', 8000);
      return;
    }
    metaAdStatusCache[adId] = newStatus;
    // Update in cached ad data
    if (metaAdData) {
      const ad = metaAdData.find(a => a.adId === adId);
      if (ad) ad.status = newStatus;
    }
    renderMetaAdGrid(metaAdData);
    showToast(`Ad ${newStatus === 'PAUSED' ? 'paused' : 'activated'}`, 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function renderAdFilterBar(startDate, endDate) {
  const filtersEl = document.getElementById('meta-ad-filters');
  if (!filtersEl) return;
  filtersEl.style.display = 'block';
  filtersEl.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 bg-dark-800/40 rounded-xl p-3 border border-dark-600/20">
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-dark-400 uppercase tracking-wider">Campaign</label>
        <select id="ad-filter-campaign" onchange="onCampaignFilterChange()" class="text-xs bg-dark-700 border border-dark-600 text-dark-200 rounded px-2 py-1.5 min-w-[180px]">
          <option value="">All Campaigns</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-dark-400 uppercase tracking-wider">Ad Set</label>
        <select id="ad-filter-adset" onchange="onAdSetFilterChange()" class="text-xs bg-dark-700 border border-dark-600 text-dark-200 rounded px-2 py-1.5 min-w-[180px]" disabled>
          <option value="">All Ad Sets</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-dark-400 uppercase tracking-wider">From</label>
        <input type="date" id="ad-filter-start" value="${startDate}" class="text-xs bg-dark-700 border border-dark-600 text-dark-200 rounded px-2 py-1.5" />
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-dark-400 uppercase tracking-wider">To</label>
        <input type="date" id="ad-filter-end" value="${endDate}" class="text-xs bg-dark-700 border border-dark-600 text-dark-200 rounded px-2 py-1.5" />
      </div>
      <button onclick="applyAdFilters()" class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30 transition-all">Apply</button>
    </div>
  `;
  // Load campaigns into dropdown
  if (_metaCycleAdId) {
    fetchMetaCampaigns(_metaCycleAdId).then(camps => {
      const sel = document.getElementById('ad-filter-campaign');
      if (!sel) return;
      camps.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
    });
  }
}

async function onCampaignFilterChange() {
  const campSel = document.getElementById('ad-filter-campaign');
  const adsetSel = document.getElementById('ad-filter-adset');
  if (!adsetSel) return;
  adsetSel.innerHTML = '<option value="">All Ad Sets</option>';
  adsetSel.disabled = true;
  metaAdFilters.campaignId = campSel ? campSel.value || null : null;
  metaAdFilters.adsetId = null;
  if (metaAdFilters.campaignId && _metaCycleAdId) {
    const adsets = await fetchMetaAdSets(_metaCycleAdId, metaAdFilters.campaignId);
    adsets.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      adsetSel.appendChild(opt);
    });
    adsetSel.disabled = false;
  }
}

function onAdSetFilterChange() {
  const adsetSel = document.getElementById('ad-filter-adset');
  metaAdFilters.adsetId = adsetSel ? adsetSel.value || null : null;
}

async function applyAdFilters() {
  const startInp = document.getElementById('ad-filter-start');
  const endInp = document.getElementById('ad-filter-end');
  const dateStart = startInp ? startInp.value : metaAdFilters.dateStart;
  const dateEnd = endInp ? endInp.value : metaAdFilters.dateEnd;
  metaAdFilters.dateStart = dateStart;
  metaAdFilters.dateEnd = dateEnd;
  if (_metaCycleAdId) {
    await loadMetaAdInsights(_metaCycleAdId, dateStart, dateEnd, {
      campaignId: metaAdFilters.campaignId,
      adsetId: metaAdFilters.adsetId
    });
  }
}

async function loadMetaAdInsights(adAccountId, startDate, endDate, filters) {
  const tableEl = document.getElementById('meta-daily-table');
  const summaryEl = document.getElementById('meta-daily-summary');
  const chartContainer = document.querySelector('#meta-daily-section .chart-container');
  if (tableEl) tableEl.innerHTML = '<div class="text-center py-8 text-dark-400 text-sm"><span class="inline-block w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin mr-2" style="vertical-align:middle;"></span>Loading ad data...</div>';
  if (summaryEl) summaryEl.innerHTML = '';
  if (chartContainer) chartContainer.style.display = 'none';

  const ads = await fetchMetaAdInsights(adAccountId, startDate, endDate, filters);
  if (!ads || !ads.length) {
    if (tableEl) tableEl.innerHTML = '<div class="text-center py-8 text-dark-400 text-sm">No ad data found for this period</div>';
    return;
  }
  await fetchAdCreativesAndStatuses(ads);
  metaAdData = ads;

  // Render summary
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalLeads = ads.reduce((s, a) => s + a.leads, 0);
  const activeCount = ads.filter(a => a.status === 'ACTIVE').length;
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="bg-dark-800/60 rounded-xl p-3 border border-dark-600/30"><div class="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Ads</div><div class="text-lg font-bold text-white">${ads.length} <span class="text-xs text-green-400 font-normal">(${activeCount} active)</span></div></div>
      <div class="bg-dark-800/60 rounded-xl p-3 border border-dark-600/30"><div class="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Total Spend</div><div class="text-lg font-bold text-white">$${totalSpend.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></div>
      <div class="bg-dark-800/60 rounded-xl p-3 border border-dark-600/30"><div class="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Total Leads</div><div class="text-lg font-bold text-white">${totalLeads}</div></div>
      <div class="bg-dark-800/60 rounded-xl p-3 border border-dark-600/30"><div class="text-[10px] text-dark-400 uppercase tracking-wider mb-1">Avg CPL</div><div class="text-lg font-bold text-white">$${totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : '—'}</div></div>
    `;
  }
  renderMetaAdGrid(ads);
}

function renderMetaAdGrid(ads) {
  const el = document.getElementById('meta-daily-table');
  if (!el || !ads) return;

  // Get dynamic thresholds from the active cycle/account
  const sel = document.getElementById('meta-cycle-select');
  const idx = sel ? parseInt(sel.value) : (_metaCycleList ? _metaCycleList.length - 1 : 0);
  const cyc = _metaCycleList && _metaCycleList[idx] ? _metaCycleList[idx] : {};
  const acct = _metaCycleAcct || {};

  // CPL threshold: Greg's Lead CPL Goal (CPA Goal × clamped L2B rate)
  const cpaGoal = acct.cpaGoal || cyc.cpaGoal || 0;
  const l2b = typeof getLeadToBookedRate === 'function' && acct.name ? getLeadToBookedRate(acct.name, 45) : null;
  const gregCPL = typeof getGregLeadCPLGoal === 'function' && cpaGoal ? getGregLeadCPLGoal(cpaGoal, l2b) : null;

  // CPC threshold: cpcMedian × cpcMultiplier (capped at $6)
  const cpcMed = cyc.cpcMedian || null;
  const cpcMult = cyc.cpcMultiplier || 1.4;
  const maxCPC = cpcMed ? Math.min(cpcMed, 6) * cpcMult : null;

  // CPM/CTR/Freq thresholds from KPI_TARGETS
  const kpi = (typeof KPI_TARGETS !== 'undefined') ? KPI_TARGETS : {};
  const cpmGood = kpi.cpm || 20;      // green if under this
  const cpmMax = 50;                    // red if over this
  const ctrGood = kpi.linkCTR || 0.9;  // green if above this %

  let html = '<div class="space-y-3">';
  ads.forEach((ad, i) => {
    const isActive = ad.status === 'ACTIVE';
    const isPaused = ad.status === 'PAUSED';
    const canToggle = isActive || isPaused;
    const statusColor = isActive ? 'bg-green-500' : isPaused ? 'bg-dark-600' : 'bg-red-500/50';
    const statusLabel = ad.status ? ad.status.charAt(0) + ad.status.slice(1).toLowerCase() : 'Unknown';

    // Dynamic CPL color: green if under greg goal, yellow within 20% over, red otherwise
    const cplColor = ad.leads > 0 ? (gregCPL ? (ad.cpl <= gregCPL ? 'text-green-400' : ad.cpl <= gregCPL * 1.2 ? 'text-yellow-400' : 'text-red-400') : (ad.cpl < 150 ? 'text-green-400' : ad.cpl < 250 ? 'text-yellow-400' : 'text-red-400')) : 'text-dark-500';
    // Dynamic CPC color: green if under max, yellow within 10% of max, red over
    const cpcColor = ad.outboundClicks > 0 ? (maxCPC ? (ad.cpc <= maxCPC * 0.8 ? 'text-green-400' : ad.cpc <= maxCPC ? 'text-yellow-400' : 'text-red-400') : (ad.cpc < 3 ? 'text-green-400' : ad.cpc < 6 ? 'text-yellow-400' : 'text-red-400')) : 'text-dark-500';
    // Dynamic CTR color
    const ctrColor = ad.ctr >= ctrGood ? 'text-green-400' : ad.ctr >= ctrGood * 0.5 ? 'text-yellow-400' : 'text-red-400';
    // Dynamic CPM color
    const cpmColor = ad.impressions > 0 ? (ad.cpm <= cpmGood ? 'text-green-400' : ad.cpm <= cpmMax ? 'text-yellow-400' : 'text-red-400') : 'text-dark-500';
    const thumbUrl = ad.thumbnail ? ad.thumbnail.replace(/'/g, "\\'") : '';
    const rank = i + 1;

    html += `
    <div class="bg-dark-800/60 rounded-xl border border-dark-600/30 hover:border-dark-500/50 transition-all flex overflow-hidden">
      <!-- Creative (left) -->
      <div class="relative flex-shrink-0 w-[200px]">
        ${ad.thumbnail
          ? `<img src="${ad.thumbnail}" class="w-full h-full object-cover cursor-pointer min-h-[140px]" onclick="showAdDetailModal(${i})" />`
          : `<div class="w-full h-full min-h-[140px] bg-dark-700 flex items-center justify-center text-dark-500 text-sm cursor-pointer" onclick="showAdDetailModal(${i})">No Creative</div>`}
        <div class="absolute top-2 left-2 bg-dark-900/80 rounded-full w-6 h-6 flex items-center justify-center backdrop-blur-sm">
          <span class="text-[10px] font-bold text-white">${rank}</span>
        </div>
      </div>
      <!-- Info (right) -->
      <div class="flex-1 p-4 flex flex-col justify-between min-w-0">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-white truncate" title="${ad.adName.replace(/"/g, '&quot;')}">${ad.adName}</div>
            <div class="text-[10px] text-dark-500 mt-0.5">ID: ${ad.adId}</div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0 bg-dark-700/60 rounded-full px-2.5 py-1">
            <span class="text-[10px] font-medium ${isActive ? 'text-green-400' : isPaused ? 'text-dark-400' : 'text-red-400'}">${statusLabel}</span>
            ${canToggle ? `<button onclick="toggleAdStatus('${ad.adId}','${ad.status}')" class="relative w-8 h-4 rounded-full transition-colors duration-200 ${statusColor}" title="Click to ${isActive ? 'pause' : 'activate'}"><span class="absolute top-0.5 ${isActive ? 'left-[16px]' : 'left-0.5'} w-3 h-3 rounded-full bg-white shadow transition-all duration-200"></span></button>` : ''}
          </div>
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          <div><span class="text-dark-400">Spend</span> <span class="text-white font-bold ml-1.5">$${ad.spend.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
          <div><span class="text-dark-400">Leads</span> <span class="text-white font-bold ml-1.5">${ad.leads}</span></div>
          <div><span class="text-dark-400">CPL</span> <span class="${cplColor} font-semibold ml-1.5">$${ad.leads > 0 ? ad.cpl.toFixed(2) : '—'}</span></div>
          <div><span class="text-dark-400">Cost/Result</span> <span class="${cplColor} font-semibold ml-1.5">$${ad.costPerResult > 0 ? ad.costPerResult.toFixed(2) : '—'}</span></div>
          <div><span class="text-dark-400">CPC</span> <span class="${cpcColor} font-semibold ml-1.5">$${ad.outboundClicks > 0 ? ad.cpc.toFixed(2) : '—'}</span></div>
          <div><span class="text-dark-400">CTR</span> <span class="${ctrColor} font-semibold ml-1.5">${ad.impressions > 0 ? ad.ctr.toFixed(2) + '%' : '—'}</span></div>
          <div><span class="text-dark-400">Freq</span> <span class="text-dark-200 ml-1.5">${ad.frequency.toFixed(2)}</span></div>
          <div><span class="text-dark-400">CPM</span> <span class="${cpmColor} font-semibold ml-1.5">$${ad.impressions > 0 ? ad.cpm.toFixed(2) : '—'}</span></div>
          <div><span class="text-dark-400">Clicks</span> <span class="text-dark-200 ml-1.5">${ad.outboundClicks}</span></div>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

let _adModalUid = 0;
function showAdDetailModal(adIndex) {
  const ad = metaAdData && metaAdData[adIndex];
  if (!ad) return;
  const existing = document.getElementById('creative-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'creative-modal';
  modal.onclick = () => modal.remove();
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:2rem;';

  const copy = ad.adCopy || {};
  const bodies = copy.bodies || (copy.body ? [copy.body] : []);
  const titles = copy.titles || (copy.title ? [copy.title] : []);
  const descriptions = copy.descriptions || [];
  const hasImage = !!ad.thumbnail;
  const hasCopy = bodies.length || titles.length;
  const MAX_LINES = 3;

  // Helper: render a truncatable text block
  function truncBlock(text, uid) {
    const lines = text.split('\n');
    const isLong = lines.length > MAX_LINES || text.length > 200;
    if (!isLong) return `<div style="font-size:13px;color:#cbd5e1;line-height:1.6;white-space:pre-wrap;">${escHtml(text)}</div>`;
    const preview = lines.slice(0, MAX_LINES).join('\n').substring(0, 200);
    return `<div id="trunc-${uid}">` +
      `<div style="font-size:13px;color:#cbd5e1;line-height:1.6;white-space:pre-wrap;">${escHtml(preview)}…</div>` +
      `<button onclick="event.stopPropagation();document.getElementById('trunc-${uid}').innerHTML='<div style=\\'font-size:13px;color:#cbd5e1;line-height:1.6;white-space:pre-wrap;\\'>${escHtml(text).replace(/'/g,'\\&#39;').replace(/\n/g,'\\n')}</div>'" ` +
      `style="color:#f97316;font-size:11px;font-weight:600;background:none;border:none;cursor:pointer;padding:4px 0;margin-top:2px;">Show more</button>` +
      `</div>`;
  }

  let content = '<div onclick="event.stopPropagation()" style="display:flex;gap:24px;max-width:950px;max-height:85vh;width:100%;">';

  // Image side
  if (hasImage) {
    content += `<div style="flex-shrink:0;max-width:${hasCopy ? '380px' : '600px'};">
      <img src="${ad.thumbnail}" style="max-width:100%;max-height:80vh;border-radius:12px;box-shadow:0 25px 50px rgba(0,0,0,0.5);" />
    </div>`;
  }

  // Copy side
  content += `<div style="flex:1;overflow-y:auto;min-width:0;">
    <div style="background:rgba(30,41,59,0.95);border-radius:12px;padding:20px;border:1px solid rgba(148,163,184,0.1);">
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;">${escHtml(ad.adName)}</div>
      <div style="font-size:11px;color:#64748b;margin-bottom:16px;">ID: ${ad.adId}</div>`;

  // Headlines
  if (titles.length) {
    content += `<div style="margin-bottom:14px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:6px;">Headline${titles.length > 1 ? 's (' + titles.length + ')' : ''}</div>`;
    titles.forEach((t, ti) => {
      content += `<div style="font-size:14px;font-weight:600;color:#e2e8f0;${ti > 0 ? 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(148,163,184,0.06);' : ''}">${escHtml(t)}</div>`;
    });
    content += '</div>';
  }

  // Primary texts (bodies)
  if (bodies.length) {
    content += `<div style="margin-bottom:14px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:6px;">Primary Text${bodies.length > 1 ? 's (' + bodies.length + ')' : ''}</div>`;
    bodies.forEach((b, bi) => {
      const uid = ++_adModalUid;
      content += `<div style="${bi > 0 ? 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.06);' : ''}">`;
      if (bodies.length > 1) content += `<div style="font-size:10px;color:#475569;margin-bottom:3px;">Variant ${bi + 1}</div>`;
      content += truncBlock(b, uid);
      content += '</div>';
    });
    content += '</div>';
  }

  // Descriptions
  if (descriptions.length) {
    content += `<div style="margin-bottom:14px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:6px;">Description${descriptions.length > 1 ? 's (' + descriptions.length + ')' : ''}</div>`;
    descriptions.forEach((d, di) => {
      content += `<div style="font-size:13px;color:#94a3b8;${di > 0 ? 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.06);' : ''}">${escHtml(d)}</div>`;
    });
    content += '</div>';
  }

  if (copy.cta) {
    content += `<div style="margin-bottom:12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:4px;">Call to Action</div>
      <div style="display:inline-block;background:rgba(249,115,22,0.15);color:#fdba74;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;">${escHtml(copy.cta)}</div>
    </div>`;
  }

  if (copy.linkUrl) {
    content += `<div style="margin-bottom:12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:4px;">Link</div>
      <div style="font-size:12px;color:#60a5fa;word-break:break-all;">${escHtml(copy.linkUrl)}</div>
    </div>`;
  }

  if (!hasCopy && !copy.cta && !copy.linkUrl && !descriptions.length) {
    content += '<div style="color:#64748b;font-size:13px;">No ad copy data available</div>';
  }

  // Quick stats
  content += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(148,163,184,0.1);">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:8px;">Performance</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px;">
      <div><span style="color:#64748b;">Spend</span> <span style="color:#fff;font-weight:700;float:right;">$${ad.spend.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
      <div><span style="color:#64748b;">Leads</span> <span style="color:#fff;font-weight:700;float:right;">${ad.leads}</span></div>
      <div><span style="color:#64748b;">CPL</span> <span style="color:#fff;float:right;">$${ad.leads > 0 ? ad.cpl.toFixed(2) : '—'}</span></div>
      <div><span style="color:#64748b;">CPC</span> <span style="color:#fff;float:right;">$${ad.outboundClicks > 0 ? ad.cpc.toFixed(2) : '—'}</span></div>
      <div><span style="color:#64748b;">CTR</span> <span style="color:#fff;float:right;">${ad.impressions > 0 ? ad.ctr.toFixed(2) + '%' : '—'}</span></div>
      <div><span style="color:#64748b;">CPM</span> <span style="color:#fff;float:right;">$${ad.impressions > 0 ? ad.cpm.toFixed(2) : '—'}</span></div>
    </div>
  </div>`;

  content += '</div></div></div>';
  modal.innerHTML = content;
  document.body.appendChild(modal);
  const closeOnEsc = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', closeOnEsc); } };
  document.addEventListener('keydown', closeOnEsc);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function switchMetaMode(mode) {
  metaViewMode = mode;
  document.querySelectorAll('.meta-mode-toggle').forEach(btn => {
    if (btn.dataset.mode === mode) { btn.style.background = 'rgba(251,146,60,0.2)'; btn.style.color = '#fdba74'; btn.classList.add('active'); }
    else { btn.style.background = 'rgba(100,116,139,0.15)'; btn.style.color = '#94a3b8'; btn.classList.remove('active'); }
  });
  const viewToggles = document.getElementById('meta-view-toggles');
  if (viewToggles) viewToggles.style.display = mode === 'ad' ? 'none' : 'flex';
  const chartContainer = document.querySelector('#meta-daily-section .chart-container');
  const filtersEl = document.getElementById('meta-ad-filters');

  if (mode === 'ad') {
    if (chartContainer) chartContainer.style.display = 'none';
    // Get current cycle dates for filter bar
    if (_metaCycleAdId && _metaCycleList && _metaCycleList.length) {
      const sel = document.getElementById('meta-cycle-select');
      const idx = sel ? parseInt(sel.value) : _metaCycleList.length - 1;
      const cyc = _metaCycleList[idx];
      if (cyc && cyc.cycleStartDate && cyc.cycleEndDate) {
        metaAdFilters = { campaignId: null, adsetId: null, dateStart: cyc.cycleStartDate, dateEnd: cyc.cycleEndDate };
        renderAdFilterBar(cyc.cycleStartDate, cyc.cycleEndDate);
        loadMetaAdInsights(_metaCycleAdId, cyc.cycleStartDate, cyc.cycleEndDate);
      }
    }
  } else {
    if (chartContainer) chartContainer.style.display = '';
    if (filtersEl) filtersEl.style.display = 'none';
    if (metaDailyData) {
      renderMetaSummary(metaDailyData);
      switchMetaView(metaCurrentView || 'full');
    }
  }
}

const KPI_TARGETS = {
  linkCTR: 0.90,    // 0.90% — values are already in percentage form
  linkCPC: 3.00,
  cpcWarn: 5.00,    // CPC yellow threshold
  cpm: 20.00,
  frequency: 2.50,
  frequencyHigh: 3.50, // danger threshold
  surveyPct: 2.00,
  osaPct: 20,         // 20% — values normalized to percentage form during parsing
  osaHighAlert: 25,   // danger threshold
};

let allAccounts = [];
let allCycles = [];
let allLeads = [];
let managerPodMap = {}; // { 'Cole': 'Pod 2 - RoofIgnite', ... } — built during data loading
let currentView = 'dashboard';
let currentPod = null;
let currentAccount = null;
let currentManager = null;

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Normalize percentage values: if value is between 0 and 1 (exclusive), multiply by 100
// This handles sheets that store 15% as 0.15 vs 15
function normPct(v) {
  if (v === null || v === undefined) return null;
  if (v > 0 && v < 1) return v * 100;
  return v;
}

// Fetch Greg Config from a named sheet tab (uses sheet= param instead of gid=)
async function fetchGregConfig() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Greg%20Config`;
    const resp = await fetch(url);
    const text = await resp.text();
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
    if (!jsonStr) { console.log('[Greg Config] No config tab found — using defaults'); return; }
    const data = JSON.parse(jsonStr[1]);
    const rows = data.table?.rows || [];
    const VALID = ['HARD','SOFT','OFF'];
    rows.forEach(row => {
      const type = row.c?.[0]?.v?.toString().trim().toLowerCase();
      const name = row.c?.[1]?.v?.toString().trim();
      const colC = (row.c?.[2]?.v?.toString().trim() || '').toUpperCase();
      const colD = (row.c?.[3]?.v?.toString().trim() || '').toUpperCase();
      if (!type || !name) return;
      let modeObj;
      if (VALID.includes(colC) && VALID.includes(colD)) {
        // New 4-column format: Col C = CPC, Col D = CPL
        modeObj = { cpc: colC, cpl: colD };
      } else if (VALID.includes(colC)) {
        // Legacy 3-column format: single mode applies to both
        modeObj = { cpc: colC, cpl: colC };
      } else {
        return;
      }
      if (type === 'manager') {
        gregConfig.managerModes[name] = modeObj;
      } else if (type === 'account') {
        gregConfig.accountModes[name] = modeObj;
      }
    });
    console.log('[Greg Config] Loaded:', gregConfig);
  } catch (e) {
    console.log('[Greg Config] Could not load config tab (may not exist yet):', e.message);
  }
}

async function fetchSheetData(sheetName, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
    if (!jsonStr) throw new Error('Failed to parse response');
    const data = JSON.parse(jsonStr[1]);
    return parseSheetData(data, sheetName);
  } catch (e) {
    console.error(`Error fetching ${sheetName}:`, e);
    return { accounts: [], cycles: [] };
  }
}

// CSV export bypasses Google Sheets filters (gviz only returns filtered/visible rows)
// Fetch pod sheet as CSV to extract ad account IDs (gviz API misses this column)
async function fetchAdIdMapCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    const lines = splitCSVLines(text);
    if (lines.length < 2) return new Map();

    const header = parseCSVRow(lines[0]);
    // Find the ad account ID column and account name column by header
    const adIdCol = header.findIndex(h => {
      const low = h.toLowerCase().trim();
      return low.includes('ad account') || low.includes('adaccount') || low === 'ad id' || low === 'ad_account_id';
    });
    const nameCol = header.findIndex(h => {
      const low = h.toLowerCase().trim();
      return low === 'account name' || low === 'account' || low === 'client' || low === 'client name';
    });

    // If we can't find by header name, fall back to column C (index 2) for ad ID and column A (index 0) for name
    const finalAdIdCol = adIdCol >= 0 ? adIdCol : 2;
    const finalNameCol = nameCol >= 0 ? nameCol : 0;

    console.log(`[CSV-AdID] gid=${gid}: header columns found — nameCol=${finalNameCol} (${header[finalNameCol] || 'N/A'}), adIdCol=${finalAdIdCol} (${header[finalAdIdCol] || 'N/A'})`);

    const map = new Map(); // accountName -> adAccountId
    let currentAccount = '';
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCSVRow(lines[i]);
      const cellA = (cells[finalNameCol] || '').trim();
      const cellAdId = (cells[finalAdIdCol] || '').trim();

      // Track current account name (account header rows have a name in column A)
      if (cellA && cellA.length > 1) currentAccount = cellA;

      // Extract ad ID: look for a 12-17 digit number (with optional "act_" prefix)
      if (cellAdId) {
        const cleaned = cellAdId.replace(/[\s,]/g, '').replace(/^act_/i, '');
        if (cleaned.length >= 10 && cleaned.length <= 20 && /^\d+$/.test(cleaned)) {
          const acctName = cellA || currentAccount;
          if (acctName && !map.has(acctName)) {
            map.set(acctName, cleaned);
          }
        }
      }
    }
    console.log(`[CSV-AdID] gid=${gid}: extracted ${map.size} account→adId mappings:`, Object.fromEntries(map));
    return map;
  } catch (e) {
    console.error(`[CSV-AdID] Error fetching CSV for gid=${gid}:`, e);
    return new Map();
  }
}

async function fetchLeadData(sheetName, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    return parseLeadCSV(text, sheetName);
  } catch (e) {
    console.error(`Error fetching leads ${sheetName}:`, e);
    return [];
  }
}

// Parse a CSV string, handling quoted fields with commas/newlines
function parseCSVRow(line) {
  const cells = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

// Split CSV text into rows, respecting quoted fields that span multiple lines
function splitCSVLines(text) {
  const rows = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur.length > 0) rows.push(cur);
      if (ch === '\r' && text[i+1] === '\n') i++;
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) rows.push(cur);
  return rows;
}

function parseLeadCSV(csvText, source) {
  const lines = splitCSVLines(csvText);
  if (lines.length < 2) return [];

  // Build column map from header row (case-insensitive partial match)
  const headerCells = parseCSVRow(lines[0]);
  const findCol = (...keywords) => {
    for (const kw of keywords) {
      const idx = headerCells.findIndex(h => h.toLowerCase().trim().includes(kw.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const COL_VA       = findCol('va');
  const COL_DATE     = findCol('date');
  const COL_SUB      = findCol('sub account', 'subaccount');
  const COL_NAME     = findCol('name');
  const COL_STATUS   = findCol('status');
  const COL_ADDRESS  = findCol('address');
  const COL_DISTANCE = findCol('distance', 'drive time', 'drivetime', 'distance & drive time');
  // Followup note columns (1st Call, 2nd Day, 3rd Day, 4th Day, 5th Day...)
  const followupCols = [];
  headerCells.forEach((h, idx) => {
    const hl = h.toLowerCase().trim();
    if (hl.includes('1st call') || hl.includes('2nd day') || hl.includes('3rd day') ||
        hl.includes('4th day') || hl.includes('5th day') || hl.includes('6th day') ||
        hl.includes('7th day') || hl.includes('follow up') || hl.includes('follow-up')) {
      followupCols.push(idx);
    }
  });

  const leads = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    const subAccount = COL_SUB >= 0 ? (cells[COL_SUB] || '').trim() : '';
    const dateRaw    = COL_DATE >= 0 ? (cells[COL_DATE] || '').trim() : '';
    if (!subAccount || !dateRaw) continue;

    // Normalize date: "M/D/YYYY" → "YYYY-MM-DD"
    let dateStr = dateRaw;
    const dm = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dm) {
      dateStr = `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;
    }

    // Get most recent followup note (scan right to left for last non-empty)
    let lastNote = '';
    for (let fi = followupCols.length - 1; fi >= 0; fi--) {
      const note = (cells[followupCols[fi]] || '').trim();
      if (note) { lastNote = note; break; }
    }

    leads.push({
      source,
      va:         COL_VA >= 0 ? (cells[COL_VA] || '').trim() : '',
      date:       dateStr,
      subAccount,
      name:       COL_NAME >= 0 ? (cells[COL_NAME] || '').trim() : '',
      status:     COL_STATUS >= 0 ? (cells[COL_STATUS] || '').trim() : '',
      address:    COL_ADDRESS >= 0 ? (cells[COL_ADDRESS] || '').trim() : '',
      distance:   COL_DISTANCE >= 0 ? (cells[COL_DISTANCE] || '').trim() : '',
      lastNote,
    });
  }
  return leads;
}

// Build a column name → index map from the header row (data.table.cols)
// Uses case-insensitive partial matching so column rearrangements don't break anything
function buildColumnMap(cols) {
  const map = {};
  if (!cols || !cols.length) return map;
  cols.forEach((col, idx) => {
    const label = (col.label || '').trim();
    if (label) map[label.toLowerCase()] = idx;
  });
  return map;
}

// Find a column index by trying multiple possible header names (case-insensitive, partial match)
function colIdx(colMap, ...names) {
  // First try exact matches
  for (const name of names) {
    const key = name.toLowerCase();
    if (colMap[key] !== undefined) return colMap[key];
  }
  // Then try partial/includes matches
  const keys = Object.keys(colMap);
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = keys.find(k => k.includes(lower) || lower.includes(k));
    if (found !== undefined) return colMap[found];
  }
  return -1; // not found
}

function parseSheetData(data, podName) {
  const rows = data.table.rows;
  const accounts = [];
  const cycles = [];
  let currentAccountName = '';
  let currentAdAccountId = '';
  let currentSection = '';
  let currentMgr = '';

  // === DYNAMIC COLUMN MAPPING ===
  // Read header labels from gviz cols array instead of hardcoding indices
  const colMap = buildColumnMap(data.table.cols);
  console.log(`[${podName}] Column map:`, colMap);

  // Map each field to its column index by header name
  // Columns A, B, C (indices 0, 1, 2) are structural — account name, cycle label, ad account id
  // Everything else is looked up dynamically
  const COL = {
    cycleStart:    colIdx(colMap, 'cycle start date', 'cycle start', 'start date'),
    cycleEnd:      colIdx(colMap, 'cycle end date', 'cycle end', 'end date'),
    bookedGoal:    colIdx(colMap, 'booked appointment goal', 'booked appt goal', 'appt goal', 'appointment goal'),
    gregGoal:      colIdx(colMap, 'greg goal', 'greg\'s goal', 'greg appointment goal', 'greg booking goal'),
    totalLeads:    colIdx(colMap, 'total leads', 'leads'),
    osaPct:        colIdx(colMap, 'osa', 'osa %', 'osa rate', 'osa pct'),
    bookedAppts:   colIdx(colMap, 'booked appointments', 'booked appts', 'booked'),
    estBooked:     colIdx(colMap, 'est. booked', 'est booked', 'estimated booked'),
    cpaGoal:       colIdx(colMap, 'cpa goal', 'cpl goal', 'cost per appt goal'),
    cpa:           colIdx(colMap, 'cpa', 'cpl', 'cost per appt', 'cost per lead'),
    dailyBudget:   colIdx(colMap, 'daily budget', 'daily'),
    monthlyBudget: colIdx(colMap, 'monthly budget', 'monthly'),
    amountSpent:   colIdx(colMap, 'amount spent', 'spent', 'total spent'),
    linkCTR:       colIdx(colMap, 'link ctr', 'ctr'),
    linkCPC:       colIdx(colMap, 'link cpc', 'cpc'),
    cpm:           colIdx(colMap, 'cpm'),
    frequency:     colIdx(colMap, 'frequency', 'freq'),
    surveyPct:     colIdx(colMap, 'survey', 'survey %', 'survey pct', 'survey rate'),
    manager:       colIdx(colMap, 'account manager', 'manager', 'acct manager'),
    notes:         colIdx(colMap, 'notes', 'note'),
    goodToBill:    colIdx(colMap, 'good to bill', 'ready to bill'),
    billed:        colIdx(colMap, 'billed'),
    billingNotes:  colIdx(colMap, 'billing notes', 'billing note'),
    adAccountId:   colIdx(colMap, 'ad account id', 'ad account', 'ad acct', 'ad acct id', 'meta id', 'fb id', 'facebook id', 'account id'),
    cpcMedian:     colIdx(colMap, 'cpc median', 'cpc goal'),
    cpcMultiplier: colIdx(colMap, 'cpc multiplier'),
    fatigueStatus: colIdx(colMap, 'fatigue status', 'fatigue', 'fatigue score', 'creative fatigue'),
  };
  console.log(`[${podName}] Resolved column indices:`, COL);
  console.log(`[${podName}] Ad Account ID column resolved to index: ${COL.adAccountId}. Column map keys:`, Object.keys(colMap).join(', '));

  // Helper to safely read a cell value by column key
  function getStr(row, colKey) {
    const idx = COL[colKey];
    if (idx === undefined || idx < 0 || !row.c || !row.c[idx]) return '';
    return String(row.c[idx].v || '').trim();
  }

  // Helper to extract ad account ID from a cell, preferring .f (formatted) to avoid precision loss
  function extractAdIdFromCell(cell) {
    if (!cell) return '';
    if ((cell.v === null || cell.v === undefined) && !cell.f) return '';
    const fVal = cell.f ? String(cell.f).trim() : '';
    // For numeric values, use Number.isInteger check and toFixed to avoid scientific notation
    let vVal = '';
    if (cell.v != null) {
      if (typeof cell.v === 'number') {
        // Avoid precision loss: if it's a safe integer, use it directly
        vVal = Number.isSafeInteger(cell.v) ? cell.v.toFixed(0) : String(cell.v);
      } else {
        vVal = String(cell.v).trim();
      }
    }
    // Prefer .f unless it's in scientific notation or contains non-numeric chars that aren't commas/spaces
    if (fVal && !/[eE]/.test(fVal)) return fVal;
    return vVal || fVal;
  }

  // === PRE-SCAN: Identify real account names by finding cellA values that appear in cycle rows ===
  const knownAccountNames = new Set();
  for (let pi = 1; pi < rows.length; pi++) {
    const pr = rows[pi];
    if (!pr.c) continue;
    const pA = pr.c[0] ? String(pr.c[0].v || '').trim() : '';
    const pB = pr.c[1] ? String(pr.c[1].v || '').trim() : '';
    const pBL = pB.toLowerCase();
    if (pA && pB && (pBL.startsWith('cycle') || (pBL.includes('winter') && pBL.includes('cycle')))) {
      knownAccountNames.add(pA);
    }
  }
  console.log(`[${podName}] Pre-scan found ${knownAccountNames.size} account names from cycle rows:`, [...knownAccountNames]);

  // Known sub-section labels that are NOT manager names
  const knownSubSections = ['kpi','roof ignite','roofignite','roofers ignite','hvac ignite','pending','expansion','active','inactive','cign ignite','solar ignite','contractorsignite','contractors ignite','paused','pause','winter'];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.c) continue;

    const cellA = row.c[0] ? (row.c[0].v || '') : '';
    const cellB = row.c[1] ? (row.c[1].v || '') : '';
    const cellCraw = row.c[2] ? (row.c[2].f || row.c[2].v || '') : '';
    const cellC = String(cellCraw).replace(/,/g, '');

    if (!cellA && !cellB && !cellC) continue;

    const cellATrimmed = String(cellA).trim();

    // SECTION HEADER: cellA is NOT a known account name (never appears in a cycle row)
    // This catches manager names (Cole, Tyler), sub-headers (RoofIgnite, HVAC Ignite, Pending), etc.
    // Works even when section rows have data beyond column C (e.g. KPI targets in manager rows)
    if (cellATrimmed && !cellB && !knownAccountNames.has(cellATrimmed)) {
      currentSection = cellATrimmed;
      // If it's not a known sub-section label, it's likely a manager name
      if (!knownSubSections.includes(cellATrimmed.toLowerCase())) {
        currentMgr = cellATrimmed;
        console.log(`[${podName}] Manager set from section header: "${cellATrimmed}"`);
      } else {
        // Sub-section (Paused, Winter, etc.) — reset manager so orphan rows show as Unassigned
        currentMgr = '';
      }
      continue;
    }

    // Try ALL possible sources for ad account ID, in priority order
    let adIdRaw = '';
    const adIdSources = [];

    // Source 1: Named column (COL.adAccountId)
    if (COL.adAccountId >= 0 && row.c[COL.adAccountId]) {
      const s1 = extractAdIdFromCell(row.c[COL.adAccountId]);
      adIdSources.push({src: 'named_col_' + COL.adAccountId, raw: s1});
      if (!adIdRaw) { const t = s1.replace(/[\s,]/g,'').replace(/^act_/i, ''); if (t.length > 3 && /^\d+$/.test(t)) adIdRaw = s1; }
    }
    // Source 2: Column C (index 2) — traditional ad ID column
    if (row.c[2]) {
      const s2 = extractAdIdFromCell(row.c[2]);
      adIdSources.push({src: 'col_C', raw: s2});
      if (!adIdRaw) { const t = s2.replace(/[\s,]/g,'').replace(/^act_/i, ''); if (t.length > 3 && /^\d+$/.test(t)) adIdRaw = s2; }
    }
    // Source 3: Scan all cells in the row for anything that looks like a Meta ad account ID (12-17 digit number)
    if (!adIdRaw) {
      for (let ci = 0; ci < row.c.length; ci++) {
        if (ci === 0 || ci === 1) continue; // skip name and cycle label
        const cell = row.c[ci];
        if (!cell) continue;
        const cv = extractAdIdFromCell(cell);
        const ct = cv.replace(/[\s,]/g,'').replace(/^act_/i, '');
        if (ct.length >= 12 && ct.length <= 17 && /^\d+$/.test(ct)) {
          adIdSources.push({src: 'scan_col_' + ci, raw: cv});
          adIdRaw = cv;
          break;
        }
      }
    }

    const rawAdId = adIdRaw.replace(/[\s,]/g,'').replace(/^act_/i, '');
    const hasAdAccountId = rawAdId.length > 3 && /^\d+$/.test(rawAdId);

    // (ad IDs may be missing from gviz — CSV fallback in loadAllData will fix these)

    const cellBStr = String(cellB).trim();
    const cellBLower = cellBStr.toLowerCase();
    const isCycleLabel = cellBStr && (cellBLower.startsWith('cycle') || (cellBLower.includes('winter') && cellBLower.includes('cycle')));

    const isPausedStatus = cellBStr && !isCycleLabel &&
      (cellBStr.toUpperCase() === 'PAUSED' || cellBStr.toUpperCase() === 'PAUSE' || cellBStr.toUpperCase() === 'WINTER');

    // Account header row: cellA is a known account name AND this is NOT a cycle row.
    // Handles: empty cellB (traditional header), "Q1 Onboarded", "PAUSED", or any non-cycle status label.
    if (cellATrimmed && knownAccountNames.has(cellATrimmed) && !isCycleLabel) {
      currentAccountName = cellATrimmed;
      currentAdAccountId = hasAdAccountId ? rawAdId : '';
      if (!hasAdAccountId && adIdRaw.trim()) console.warn(`[AdID] Could not parse ad account ID for "${currentAccountName}": raw="${adIdRaw}"`);
      if (hasAdAccountId) console.log(`[AdID] ${currentAccountName} → ${currentAdAccountId}`);

      const mgr = getStr(row, 'manager');
      if (mgr) currentMgr = mgr;

      // Don't create duplicate account if we already have one with this name
      const existingAcct = accounts.find(a => a.name === currentAccountName);
      if (!existingAcct) {
        accounts.push({
          name: currentAccountName,
          adAccountId: currentAdAccountId,
          pod: podName,
          section: currentSection,
          manager: currentMgr || 'Unassigned',
          isPaused: isPausedStatus,
          status: cellBStr || '',
          bookedGoal:    COL.bookedGoal >= 0 ? getNum(row, COL.bookedGoal) : null,
          gregGoal:      COL.gregGoal >= 0 ? getNum(row, COL.gregGoal) : null,
          cpaGoal:       COL.cpaGoal >= 0 ? getNum(row, COL.cpaGoal) : null,
          dailyBudget:   COL.dailyBudget >= 0 ? getNum(row, COL.dailyBudget) : null,
          monthlyBudget: COL.monthlyBudget >= 0 ? getNum(row, COL.monthlyBudget) : null,
          cycles: []
        });
        console.log(`[Parse] Created account: "${currentAccountName}" manager="${currentMgr}" section="${currentSection}" status="${cellBStr}"`);
      } else {
        // Update existing account with new data if this row has better info
        if (hasAdAccountId && !existingAcct.adAccountId) existingAcct.adAccountId = currentAdAccountId;
      }
      continue;
    }

    if (isCycleLabel && currentAccountName) {
      // Always pick up ad ID from cycle row if available — cycle rows are the source of truth
      if (hasAdAccountId) {
        if (!currentAdAccountId || currentAdAccountId !== rawAdId) {
          currentAdAccountId = rawAdId;
          console.log(`[AdID] ${currentAccountName} (from cycle row) → ${currentAdAccountId}`);
        }
        // Always propagate to parent account if it's missing
        const parentAcctFix = accounts.find(a => a.name === currentAccountName && !a.adAccountId);
        if (parentAcctFix) parentAcctFix.adAccountId = currentAdAccountId;
      }
      const rowMgr = getStr(row, 'manager');
      if (rowMgr) currentMgr = rowMgr;

      const cycleData = {
        account: currentAccountName,
        adAccountId: currentAdAccountId,
        pod: podName,
        manager: currentMgr || 'Unassigned',
        cycle: cellBStr,
        cycleStartDate: COL.cycleStart >= 0 ? getDate(row, COL.cycleStart) : null,
        cycleEndDate:   COL.cycleEnd >= 0 ? getDate(row, COL.cycleEnd) : null,
        bookedGoal:     COL.bookedGoal >= 0 ? getNum(row, COL.bookedGoal) : null,
        gregGoal:       COL.gregGoal >= 0 ? getNum(row, COL.gregGoal) : null,
        totalLeads:     COL.totalLeads >= 0 ? getNum(row, COL.totalLeads) : null,
        osaPct:         COL.osaPct >= 0 ? normPct(getNum(row, COL.osaPct)) : null,
        bookedAppts:    COL.bookedAppts >= 0 ? getNum(row, COL.bookedAppts) : null,
        estBookedAppts: COL.estBooked >= 0 ? getNum(row, COL.estBooked) : null,
        cpaGoal:        COL.cpaGoal >= 0 ? getNum(row, COL.cpaGoal) : null,
        cpa:            COL.cpa >= 0 ? getNum(row, COL.cpa) : null,
        dailyBudget:    COL.dailyBudget >= 0 ? getNum(row, COL.dailyBudget) : null,
        monthlyBudget:  COL.monthlyBudget >= 0 ? getNum(row, COL.monthlyBudget) : null,
        amountSpent:    COL.amountSpent >= 0 ? getNum(row, COL.amountSpent) : null,
        linkCTR:        COL.linkCTR >= 0 ? getNum(row, COL.linkCTR) : null,
        linkCPC:        COL.linkCPC >= 0 ? getNum(row, COL.linkCPC) : null,
        cpm:            COL.cpm >= 0 ? getNum(row, COL.cpm) : null,
        frequency:      COL.frequency >= 0 ? getNum(row, COL.frequency) : null,
        surveyPct:      COL.surveyPct >= 0 ? normPct(getNum(row, COL.surveyPct)) : null,
        accountManager: rowMgr || currentMgr,
        notes:          COL.notes >= 0 ? getStr(row, 'notes') : '',
        goodToBill:     COL.goodToBill >= 0 ? getStr(row, 'goodToBill') : '',
        billed:         COL.billed >= 0 ? getStr(row, 'billed') : '',
        billingNotes:   COL.billingNotes >= 0 ? getStr(row, 'billingNotes') : '',
        cpcMedian:      COL.cpcMedian >= 0 ? getNum(row, COL.cpcMedian) : null,
        cpcMultiplier:  COL.cpcMultiplier >= 0 ? getNum(row, COL.cpcMultiplier) : null,
        fatigueStatus:  COL.fatigueStatus >= 0 ? getStr(row, 'fatigueStatus') : '',
      };

      cycles.push(cycleData);
      let parentAcct = accounts.find(a => a.name === currentAccountName && a.adAccountId === currentAdAccountId);
      // Fallback: find by name only if strict match fails
      if (!parentAcct) parentAcct = accounts.find(a => a.name === currentAccountName);
      if (parentAcct) {
        parentAcct.cycles.push(cycleData);
        // Ensure parent has ad ID if cycle has one
        if (currentAdAccountId && !parentAcct.adAccountId) parentAcct.adAccountId = currentAdAccountId;
      }
    }
  }

  // Post-parse fixup: correct account manager from cycle data (cycle rows are source of truth)
  accounts.forEach(acct => {
    if (acct.cycles.length > 0) {
      const cycleMgr = acct.cycles.find(c => c.accountManager && c.accountManager !== acct.manager);
      if (cycleMgr && cycleMgr.accountManager) {
        console.log(`[Mgr-PostFix] ${acct.name}: correcting manager "${acct.manager}" → "${cycleMgr.accountManager}" (from cycle data)`);
        acct.manager = cycleMgr.accountManager;
      }
    }
  });

  // Post-parse fixup: scan cycles for ad IDs and propagate to parent accounts
  accounts.forEach(acct => {
    if (!acct.adAccountId) {
      const cycleWithId = acct.cycles.find(c => c.adAccountId);
      if (cycleWithId) {
        acct.adAccountId = cycleWithId.adAccountId;
        console.log(`[AdID-PostFix] ${acct.name}: got ad ID from cycle → ${acct.adAccountId}`);
      }
    }
    // Also check global cycles array for this account name
    if (!acct.adAccountId) {
      const globalCycle = cycles.find(c => c.account === acct.name && c.adAccountId);
      if (globalCycle) {
        acct.adAccountId = globalCycle.adAccountId;
        console.log(`[AdID-PostFix] ${acct.name}: got ad ID from global cycles → ${acct.adAccountId}`);
      }
    }
  });

  // Debug: dump accounts missing ad IDs and what their raw cycle data looks like
  const noAdId = accounts.filter(a => !a.adAccountId && a.cycles.length > 0);
  if (noAdId.length > 0) {
    console.warn(`[AdID-Missing] ${noAdId.length} accounts with cycles but no ad ID:`, noAdId.map(a => `${a.name} (${a.cycles.length} cycles)`));
  }

  // Ghost account filter — now much simpler since the two-pass approach properly identifies sections.
  // Only accounts from knownAccountNames can be created, so section headers are already excluded.
  // Just filter out any 0-cycle accounts that have absolutely no data as a safety net.
  const beforeCount = accounts.length;
  const filtered = accounts.filter(a => {
    if (a.cycles.length > 0) return true;
    // Keep if account has any meaningful data (goals, budget, ad ID, or status)
    if (a.adAccountId || a.bookedGoal || a.monthlyBudget || a.cpaGoal || a.status) return true;
    console.log(`[Parse] Filtering ghost account: "${a.name}" (0 cycles, no data)`);
    return false;
  });
  if (filtered.length < beforeCount) {
    console.log(`[Parse] Filtered out ${beforeCount - filtered.length} ghost accounts`);
  }

  console.log(`[${podName}] Final: ${filtered.length} accounts, ${cycles.length} cycles`);
  const mgrDist = {};
  filtered.forEach(a => { mgrDist[a.manager] = (mgrDist[a.manager]||0) + 1; });
  console.log(`[${podName}] Manager distribution:`, mgrDist);

  return { accounts: filtered, cycles };
}

function getNum(row, idx) {
  if (!row.c || !row.c[idx]) return null;
  const v = row.c[idx].v;
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function getDate(row, idx) {
  if (!row.c || !row.c[idx]) return null;
  const cell = row.c[idx];
  const v = cell.v;
  if (!v) return null;

  // Try parsing Date() format first (most reliable from gviz)
  if (typeof v === 'string' && v.includes('Date(')) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) return `${m[1]}-${String(Number(m[2])+1).padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }

  // Try formatted value
  if (cell.f) {
    const d = new Date(cell.f);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return cell.f;
  }

  // Try raw string value
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return v;
  }

  // Numeric (Excel serial date) — convert
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  return String(v);
}

async function loadAllData(opts) {
  const silent = opts && opts.silent;
  if (!silent) document.getElementById('loading-state').classList.remove('hidden');

  // Auto-detect pod tabs from Google Sheet (so manually-added pods appear)
  if (APPS_SCRIPT_URL) {
    try {
      const sheetList = await writeToSheet('getSheetList', {}, { silent: true });
      if (sheetList.ok && sheetList.pods) {
        // Merge detected pods into SHEETS — keeps existing entries, adds new ones
        sheetList.pods.forEach(p => {
          if (!SHEETS[p.name]) {
            SHEETS[p.name] = p.gid;
            console.log(`[AutoDetect] Discovered new pod: "${p.name}" (GID: ${p.gid})`);
          }
        });
        // Also update GIDs for existing pods if they were wrong
        sheetList.pods.forEach(p => {
          if (SHEETS[p.name] != null && SHEETS[p.name] !== p.gid) {
            console.log(`[AutoDetect] Updated GID for "${p.name}": ${SHEETS[p.name]} → ${p.gid}`);
            SHEETS[p.name] = p.gid;
          }
          // Capture lead source info if the backend provides it (Pod Registry v2)
          if (p.leadSource && CONFIG.POD_LEAD_SOURCES) {
            CONFIG.POD_LEAD_SOURCES[p.name] = {
              primary: p.leadSource,
              fallback: p.fallbackSource || (p.leadSource === 'ALL_CiGN' ? 'ALL_ROOF' : 'ALL_CiGN')
            };
          }
        });
        renderSidebarPods();
      }
    } catch (e) {
      console.warn('[AutoDetect] Could not fetch sheet list:', e.message);
    }
  }

  // Dynamic pod loading — fetches all pods from CONFIG.SHEETS
  const podNames = Object.keys(SHEETS);
  const [podResults, leadResults, adIdMaps] = await Promise.all([
    Promise.all(podNames.map(name => fetchSheetData(name, SHEETS[name]))),
    Promise.all([
      fetchLeadData('ALL_ROOF', LEAD_SHEETS['ALL_ROOF']),
      fetchLeadData('ALL_CiGN', LEAD_SHEETS['ALL_CiGN'])
    ]),
    Promise.all(podNames.map(name => fetchAdIdMapCSV(SHEETS[name])))
  ]);

  allAccounts = podResults.flatMap(r => r.accounts);
  allCycles = podResults.flatMap(r => r.cycles);
  allLeads = leadResults.flat();

  // Build managerPodMap deterministically AFTER all data loads (not during parallel parsing)
  managerPodMap = {};
  allAccounts.forEach(a => {
    if (a.manager && a.pod && !managerPodMap[a.manager]) {
      managerPodMap[a.manager] = a.pod;
    }
  });
  console.log('[ManagerPodMap] Built from accounts:', JSON.stringify(managerPodMap));

  // Merge CSV-derived ad account IDs into accounts and cycles
  const combinedAdIdMap = new Map(adIdMaps.flatMap(m => [...m]));
  console.log(`[CSV-AdID] Combined map has ${combinedAdIdMap.size} entries`);
  let csvFixCount = 0;
  allAccounts.forEach(acct => {
    if (!acct.adAccountId) {
      const csvId = combinedAdIdMap.get(acct.name);
      if (csvId) {
        acct.adAccountId = csvId;
        csvFixCount++;
        console.log(`[CSV-AdID] Fixed account "${acct.name}" → ${csvId}`);
      }
    }
    // Also fix cycles for this account
    (acct.cycles || []).forEach(c => {
      if (!c.adAccountId && acct.adAccountId) c.adAccountId = acct.adAccountId;
    });
  });
  // Fix global cycles too
  allCycles.forEach(c => {
    if (!c.adAccountId) {
      const csvId = combinedAdIdMap.get(c.account);
      if (csvId) c.adAccountId = csvId;
    }
  });
  console.log(`[CSV-AdID] Fixed ${csvFixCount} accounts with CSV-derived ad IDs`);

  // Debug: log account count and manager distribution
  console.log(`Total accounts parsed: ${allAccounts.length}, Total cycles: ${allCycles.length}`);
  const mgrCounts = {};
  allAccounts.forEach(a => {
    const m = a.manager || 'Unassigned';
    mgrCounts[m] = (mgrCounts[m] || 0) + 1;
  });
  console.log('Manager distribution (account-level):', mgrCounts);
  const cycleMgrCounts = {};
  allCycles.forEach(c => {
    const m = c.accountManager || c.manager || 'Unassigned';
    cycleMgrCounts[m] = (cycleMgrCounts[m] || 0) + 1;
  });
  console.log('Manager distribution (cycle-level):', cycleMgrCounts);

  // Initialize Greg config: set defaults then load from Greg Config sheet if it exists
  initGregConfig();
  await fetchGregConfig();

  // Populate account dropdown
  const sel = document.getElementById('account-select');
  sel.innerHTML = '<option value="">Search account...</option>';
  const activeAccounts = allAccounts.filter(a => hasActiveCycle(a)).sort((a,b) => a.name.localeCompare(b.name));
  const inactiveAccounts = allAccounts.filter(a => !hasActiveCycle(a)).sort((a,b) => a.name.localeCompare(b.name));

  activeAccounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name + '|||' + a.adAccountId;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
  if (inactiveAccounts.length) {
    const group = document.createElement('optgroup');
    group.label = '⏸ Inactive';
    inactiveAccounts.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name + '|||' + a.adAccountId;
      opt.textContent = a.name;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  }

  document.getElementById('data-status').className = 'w-2 h-2 rounded-full bg-green-500';
  document.getElementById('data-status-text').textContent = `${allAccounts.length} accounts · ${allLeads.length} leads`;

  // Render dynamic sidebar
  renderSidebarManagers();
  renderSidebarPods();

  // Update manager alert badges (dynamic)
  getManagers().forEach(mgr => {
    const alerts = getAlertAccountsForManager(mgr);
    const key = mgr.toLowerCase().replace(/\s+/g, '-');
    const badge = document.getElementById('alert-badge-' + key);
    if (badge && alerts.length > 0) {
      badge.textContent = alerts.length;
      badge.classList.remove('hidden');
    }
  });

  if (!silent) document.getElementById('loading-state').classList.add('hidden');

  // v2: Skip auto-navigation — each page handles its own rendering
  // The page-specific init script reads URL params and renders the appropriate view
}

let _refreshBusy = false;
let _lastRefreshTime = null;

async function refreshData() {
  if (_refreshBusy) { showToast('Refresh already in progress', 'info'); return; }
  _refreshBusy = true;
  const statusDot = document.getElementById('data-status');
  const statusText = document.getElementById('data-status-text');
  const refreshBtn = document.getElementById('refresh-data-btn');
  if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-yellow-500 pulse';
  if (statusText) statusText.textContent = 'Refreshing...';
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.style.opacity = '0.5'; }

  // Preserve scroll and view state
  const mainContent = document.querySelector('.main-content');
  const scrollTop = mainContent ? mainContent.scrollTop : 0;
  const savedNav = JSON.parse(localStorage.getItem('nav_state') || 'null');

  try {
    await loadAllData({ silent: true });

    // Restore scroll position after re-render
    if (mainContent) requestAnimationFrame(() => { mainContent.scrollTop = scrollTop; });

    _lastRefreshTime = new Date();
    if (statusText) statusText.textContent = `${allAccounts.length} accounts · ${allLeads.length} leads · just now`;
    showToast('Data refreshed', 'success');
  } catch (e) {
    console.warn('[Refresh] Error:', e);
    if (statusText) statusText.textContent = 'Refresh failed';
    showToast('Refresh failed — try again', 'error');
  } finally {
    _refreshBusy = false;
    if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-green-500';
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.style.opacity = '1'; }
  }
}

// Update "last refreshed" timestamp every minute
setInterval(() => {
  if (!_lastRefreshTime) return;
  const statusText = document.getElementById('data-status-text');
  if (!statusText) return;
  const mins = Math.floor((Date.now() - _lastRefreshTime.getTime()) / 60000);
  const ago = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`;
  statusText.textContent = `${allAccounts.length} accounts · ${allLeads.length} leads · ${ago}`;
}, 60000);

// Legacy stubs — prevent errors if anything still references these
function startLiveRefresh() {}
function stopLiveRefresh() {}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function fmt(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtDollar(n, decimals = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(0) + '%';
}
function fmtPctDec(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(decimals) + '%';
}
// Parse YYYY-MM-DD as local time to avoid UTC timezone shift
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(dateStr) {
  if (!dateStr || dateStr === '—') return '—';
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Metric coloring helpers
function osaColor(v) {
  if (v === null || v === undefined) return 'text-dark-400';
  return v < KPI_TARGETS.osaPct ? 'metric-good' : 'metric-bad';
}
function cpaColor(v, goal) {
  if (v === null || v === undefined) return 'text-dark-400';
  if (!goal) return 'metric-neutral';
  return v <= goal ? 'metric-good' : 'metric-bad';
}
function ctrColor(v) {
  if (v === null || v === undefined || v === 0) return 'text-dark-400';
  // v is already in percentage form (1.04 = 1.04%), compare to target also in % form
  return v >= KPI_TARGETS.linkCTR ? 'metric-good' : 'metric-bad';
}
function cpcColor(v) {
  if (v === null || v === undefined) return 'text-dark-400';
  return v <= KPI_TARGETS.linkCPC ? 'metric-good' : 'metric-bad';
}
function cpmColor(v) {
  if (v === null || v === undefined) return 'text-dark-400';
  return v <= KPI_TARGETS.cpm ? 'metric-good' : 'metric-bad';
}
function freqColor(v) {
  if (v === null || v === undefined) return 'text-dark-400';
  return v <= KPI_TARGETS.frequency ? 'metric-good' : (v <= 3.5 ? 'metric-warn' : 'metric-bad');
}
function surveyColor(v) {
  if (v === null || v === undefined) return 'text-dark-400';
  return v >= KPI_TARGETS.surveyPct ? 'metric-good' : 'metric-bad';
}

// Lead status color: green=booked, red=cancelled/invalid, white=other
function leadStatusColor(status) {
  if (!status) return 'lead-open';
  if (isBookedStatus(status)) return 'lead-booked';
  if (isClientHandles(status)) return 'lead-client';
  if (isCancelledStatus(status)) return 'lead-cancelled';
  return 'lead-open';
}

function isBookedStatus(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  // "Confirmed" but NOT "Unconfirmed", and NOT "other" (client handles / satellite)
  if (isClientHandles(status)) return false;
  if (s === 'confirmed') return true;
  if (s.includes('confirmed') && !s.includes('unconfirmed')) return true;
  if (s.includes('manual booked')) return true;
  return false;
}

function isClientHandles(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s.includes('client handles') || s.includes('satellite') || s.includes('sat quote') || s.includes('sat. qt');
}

function isCancelledStatus(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  return s.includes('cancel') || s.includes('invalid') || s.includes('not responding') || s === 'nr';
}

// "Open" = anything not booked, not client handles, and not cancelled
function isOpenStatus(status) {
  return !isBookedStatus(status) && !isClientHandles(status) && !isCancelledStatus(status);
}

// Active lead filter state for the breakdown table
let activeLeadFilter = 'all'; // 'all', 'booked', 'client', 'cancelled', 'open'

// ═══════════════════════════════════════════════
// GREG-INSPIRED ANALYTICS (derived from sheet data)
// ═══════════════════════════════════════════════

// Lead-to-Booked Rate: same logic as Greg's 45-day lookback
// Uses the actual lead data to compute what % of leads end up booked
function getLeadToBookedRate(accountName, lookbackDays) {
  lookbackDays = lookbackDays || 45;
  const today = new Date();
  const cutoff = new Date(today.getTime() - lookbackDays * 86400000);
  const cutoffStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');

  const acctLeads = allLeads.filter(l => {
    const nameMatch = l.subAccount.toLowerCase().includes(accountName.toLowerCase()) || accountName.toLowerCase().includes(l.subAccount.toLowerCase());
    return nameMatch && l.date && l.date >= cutoffStr;
  });

  if (acctLeads.length < 3) return null; // not enough data
  const booked = acctLeads.filter(l => isBookedStatus(l.status)).length;
  return booked / acctLeads.length;
}

// Greg's Lead CPL Goal = Booking CPL Goal × Lead-to-Booked Rate (clamped 37.5%–60%)
function getGregLeadCPLGoal(bookingCPLGoal, l2bRate) {
  if (!bookingCPLGoal || l2bRate === null || l2bRate === undefined) return null;
  const clampedRate = Math.min(0.60, Math.max(0.375, l2bRate));
  return bookingCPLGoal * clampedRate;
}

// Booking Pacing: based on current CPA, remaining budget, and booked goal
// Are we on track to hit within 80% of the booking target?
function getBookingPacing(cycle) {
  if (!cycle || !cycle.cycleStartDate || !cycle.cycleEndDate) return null;
  const budget = cycle.monthlyBudget || null;
  const bookedGoal = cycle.bookedGoal || null;
  const currentBooked = cycle.bookedAppts || 0;
  const spent = cycle.amountSpent || 0;
  const cpa = cycle.cpa || 0;
  if (!budget || !bookedGoal) return null;

  const startMs = parseLocalDate(cycle.cycleStartDate).getTime();
  const endMs = parseLocalDate(cycle.cycleEndDate).getTime();
  const nowMs = Date.now();
  const totalDays = Math.max(1, (endMs - startMs) / 86400000);
  const elapsedDays = Math.max(0, Math.min(totalDays, (nowMs - startMs) / 86400000));
  const pctElapsed = Math.min(1, elapsedDays / totalDays);
  const daysLeft = Math.max(0, Math.ceil((endMs - nowMs) / 86400000));
  const remainingBudget = Math.max(0, budget - spent);

  // Project total bookings: current booked + (remaining budget / current CPA)
  const projectedAdditional = (cpa > 0 && daysLeft > 0) ? remainingBudget / cpa : 0;
  const projectedTotal = currentBooked + projectedAdditional;
  const pctOfGoal = bookedGoal > 0 ? projectedTotal / bookedGoal : 0;

  // On track = projected to hit >= 80% of goal
  const status = pctOfGoal >= 0.95 ? 'on-track' : pctOfGoal >= 0.80 ? 'close' : 'behind';

  return {
    currentBooked,
    bookedGoal,
    projectedTotal: Math.round(projectedTotal),
    pctOfGoal,
    pctElapsed,
    daysLeft,
    remainingBudget,
    cpa,
    status,
  };
}

function bookingPaceColor(status) {
  if (status === 'on-track') return '#22c55e';
  if (status === 'close') return '#eab308';
  return '#ef4444';
}

function bookingPaceLabel(status) {
  if (status === 'on-track') return 'On Track';
  if (status === 'close') return 'Close';
  return 'Behind';
}

// Get the cycle before the current one for trend comparison
function getPreviousCycle(accountName, adAccountId, currentCycle) {
  if (!currentCycle || !currentCycle.cycleStartDate) return null;
  let acctCycles = allCycles.filter(c => c.account === accountName && c.adAccountId === adAccountId);
  if (!acctCycles.length) acctCycles = allCycles.filter(c => c.account === accountName);
  const sorted = acctCycles.filter(c => c.cycleStartDate && c.cycleStartDate < currentCycle.cycleStartDate)
    .sort((a, b) => b.cycleStartDate.localeCompare(a.cycleStartDate));
  return sorted.length > 0 ? sorted[0] : null;
}

// Performance Health Score (0–100) composite — v3
// Weights: Pace (90%) · Supporting Metrics (10%: CPA, OSA, CTR, Frequency)
function getHealthScore(acct, cycle) {
  if (!cycle) return null;

  // ── PACE COMPONENT (90 pts) ──
  let paceScore = null;
  const bkPacing = getBookingPacing(cycle);
  if (bkPacing) {
    // Use pctOfGoal for a smooth 0–90 scale
    // 100%+ of goal → 90, scales linearly down to 0
    const pct = Math.min(bkPacing.pctOfGoal, 1.2); // cap at 120%
    paceScore = Math.round(Math.min(90, pct * 90));
  }

  // If we have no pace data, fall back to est booked vs goal
  if (paceScore === null && cycle.estBookedAppts !== null && cycle.bookedGoal) {
    const ratio = Math.min(cycle.estBookedAppts / cycle.bookedGoal, 1.2);
    paceScore = Math.round(Math.min(90, ratio * 90));
  }

  if (paceScore === null) return null;

  // ── SUPPORTING METRICS (10 pts) ──
  let suppScore = 0;
  let suppMax = 0;

  // CPA vs Goal (up to 4 pts)
  const cpaGoal = acct.cpaGoal || cycle.cpaGoal;
  if (cpaGoal && cycle.cpa && cycle.cpa > 0) {
    suppMax += 4;
    const ratio = cycle.cpa / cpaGoal;
    if (ratio <= 0.85) suppScore += 4;
    else if (ratio <= 1.0) suppScore += 3;
    else if (ratio <= 1.2) suppScore += 2;
    else if (ratio <= 1.5) suppScore += 1;
  }

  // OSA (up to 2 pts)
  if (cycle.osaPct !== null) {
    suppMax += 2;
    if (cycle.osaPct < 12) suppScore += 2;
    else if (cycle.osaPct < 20) suppScore += 1;
  }

  // CTR (up to 2 pts)
  if (cycle.linkCTR !== null && cycle.linkCTR > 0) {
    suppMax += 2;
    if (cycle.linkCTR >= 1.2) suppScore += 2;
    else if (cycle.linkCTR >= 0.8) suppScore += 1;
  }

  // Frequency (up to 2 pts)
  if (cycle.frequency !== null) {
    suppMax += 2;
    if (cycle.frequency <= 2.0) suppScore += 2;
    else if (cycle.frequency <= 2.5) suppScore += 1;
  }

  const suppFinal = suppMax > 0 ? Math.round((suppScore / suppMax) * 10) : 5; // default 5 if no data

  return Math.min(100, paceScore + suppFinal);
}

function healthScoreColor(score) {
  if (score === null) return { bg: 'rgba(100,116,139,0.2)', text: '#94a3b8' };
  if (score >= 80) return { bg: 'rgba(34,197,94,0.2)', text: '#22c55e' };
  if (score >= 60) return { bg: 'rgba(234,179,8,0.2)', text: '#eab308' };
  if (score >= 40) return { bg: 'rgba(249,115,22,0.2)', text: '#f97316' };
  return { bg: 'rgba(239,68,68,0.2)', text: '#ef4444' };
}

// Fatigue Score Color (higher = worse, inverse of health)
// Green (0-39), Yellow (40-59), Orange (60-79), Red (80-100)
function fatigueScoreColor(score) {
  if (score === null || score === undefined) return { bg: 'rgba(100,116,139,0.2)', text: '#94a3b8' };
  if (score >= 80) return { bg: 'rgba(239,68,68,0.2)', text: '#ef4444' };
  if (score >= 60) return { bg: 'rgba(249,115,22,0.2)', text: '#f97316' };
  if (score >= 40) return { bg: 'rgba(234,179,8,0.2)', text: '#eab308' };
  return { bg: 'rgba(34,197,94,0.2)', text: '#22c55e' };
}

// Parse fatigue status string (e.g. "55" or "55/Orange" or just a number) into a score
function parseFatigueScore(statusStr) {
  if (!statusStr) return null;
  const s = String(statusStr).trim();
  if (!s) return null;
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 0 && num <= 100) return num;
  const match = s.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);
  return null;
}

// Get fatigue score for an account from its active cycle data
function getFatigueScore(acct, cycle) {
  if (cycle && cycle.fatigueStatus) return parseFatigueScore(cycle.fatigueStatus);
  return null;
}

// ═══════════════════════════════════════════════
// ACTIVE CYCLE LOGIC — cycles containing today
// ═══════════════════════════════════════════════
function getActiveCycle(accountName, adAccountId) {
  let acctCycles = allCycles.filter(c => c.account === accountName && c.adAccountId === adAccountId);
  // Fallback: if strict ad ID match fails, try name-only match
  if (!acctCycles.length) acctCycles = allCycles.filter(c => c.account === accountName);
  if (!acctCycles.length) return null;
  const today = getTodayStr();
  const active = acctCycles.find(c => c.cycleStartDate && c.cycleEndDate && c.cycleStartDate <= today && c.cycleEndDate >= today);
  return active || acctCycles[acctCycles.length - 1]; // fallback to latest
}

function hasActiveCycle(acct) {
  const today = getTodayStr();
  return (acct.cycles || []).some(c => c.cycleStartDate && c.cycleEndDate && c.cycleStartDate <= today && c.cycleEndDate >= today);
}

// On-track: Est. Booked Appts >= 80% of Booked Appointment Goal
function isOnTrack(cycle) {
  if (!cycle) return null;
  if (cycle.estBookedAppts === null || cycle.bookedGoal === null || !cycle.bookedGoal) return null;
  return cycle.estBookedAppts >= 0.8 * cycle.bookedGoal;
}

function onTrackBadge(cycle) {
  const track = isOnTrack(cycle);
  if (track === null) return '<span class="badge badge-gray">N/A</span>';
  return track
    ? '<span class="w-2 h-2 rounded-full bg-green-500 inline-block" title="On Track"></span>'
    : '<span class="w-2 h-2 rounded-full bg-red-500 inline-block" title="Off Track"></span>';
}

// ═══════════════════════════════════════════════
// MANAGER & ALERTS LOGIC
// ═══════════════════════════════════════════════
// FIX: Check ALL cycles and account-level manager, not just active cycle
function getAccountsByManager(mgrName) {
  const mgrLower = mgrName.toLowerCase();
  return allAccounts.filter(a => {
    // Check account-level manager
    const acctMgr = (a.manager || '').toLowerCase();
    if (acctMgr === mgrLower || acctMgr.includes(mgrLower)) return true;
    // Check ANY cycle for this manager name
    return (a.cycles || []).some(c => {
      const mgr = (c.accountManager || c.manager || '').toLowerCase();
      return mgr === mgrLower || mgr.includes(mgrLower);
    });
  });
}

function getAlertAccountsForManager(mgrName) {
  const mgrAccounts = getAccountsByManager(mgrName).filter(a => hasActiveCycle(a));
  const alerts = [];
  mgrAccounts.forEach(acct => {
    const active = getActiveCycle(acct.name, acct.adAccountId);
    if (!active) return;

    // Only flag off-track accounts
    const track = isOnTrack(active);
    if (track === false) {
      const pct = active.bookedGoal ? Math.round((active.estBookedAppts / active.bookedGoal) * 100) : 0;
      alerts.push({
        account: acct, active,
        issues: [{ type: pct < 50 ? 'danger' : 'warning', msg: `Off track: Est. ${fmt(active.estBookedAppts)} / ${fmt(active.bookedGoal)} goal (${pct}%)` }]
      });
    }
  });
  return alerts.sort((a, b) => {
    const aRatio = a.active.bookedGoal ? a.active.estBookedAppts / a.active.bookedGoal : 1;
    const bRatio = b.active.bookedGoal ? b.active.estBookedAppts / b.active.bookedGoal : 1;
    return aRatio - bRatio; // worst performers first
  });
}

function getAllAlerts() {
  const alerts = [];
  allAccounts.filter(a => hasActiveCycle(a)).forEach(acct => {
    const active = getActiveCycle(acct.name, acct.adAccountId);
    if (!active) return;

    // Only flag off-track accounts
    const track = isOnTrack(active);
    if (track === false) {
      const pct = active.bookedGoal ? Math.round((active.estBookedAppts / active.bookedGoal) * 100) : 0;
      const severity = pct < 50 ? 'danger' : 'warning';
      alerts.push({
        account: acct, active,
        issues: [{ type: severity, msg: `Off track: Est. ${fmt(active.estBookedAppts)} / ${fmt(active.bookedGoal)} goal (${pct}%)`, current: fmt(active.estBookedAppts), threshold: fmt(active.bookedGoal) }]
      });
    }
  });
  return alerts.sort((a, b) => {
    const aRatio = a.active.bookedGoal ? a.active.estBookedAppts / a.active.bookedGoal : 1;
    const bRatio = b.active.bookedGoal ? b.active.estBookedAppts / b.active.bookedGoal : 1;
    return aRatio - bRatio; // worst performers first
  });
}

function calculateCycleDeltas(current, previous) {
  if (!current || !previous) return null;
  const delta = (cur, prev, lowerIsBetter) => {
    if (cur == null || prev == null || prev === 0) return null;
    const pctChange = ((cur - prev) / Math.abs(prev)) * 100;
    const direction = cur > prev ? 'up' : cur < prev ? 'down' : 'flat';
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
    const isGood = lowerIsBetter ? (cur <= prev) : (cur >= prev);
    return { current: cur, previous: prev, pctChange, direction, arrow, isGood };
  };
  return {
    leads: delta(current.totalLeads, previous.totalLeads, false),
    booked: delta(current.bookedAppts, previous.bookedAppts, false),
    cpa: delta(current.cpa, previous.cpa, true),
    ctr: delta(current.linkCTR, previous.linkCTR, false),
    frequency: delta(current.frequency, previous.frequency, true),
    spend: delta(current.amountSpent, previous.amountSpent, false),
  };
}

function getAccountsByPod(podName) { return allAccounts.filter(a => a.pod === podName); }

function getLeadsForAccount(accountName, startDate, endDate) {
  return allLeads.filter(l => {
    const nameMatch = l.subAccount.toLowerCase().includes(accountName.toLowerCase()) || accountName.toLowerCase().includes(l.subAccount.toLowerCase());
    if (!nameMatch) return false;
    if (startDate && endDate && l.date) {
      return l.date >= startDate && l.date <= endDate;
    }
    return true;
  });
}

// ═══════════════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════════════
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('active');
  document.body.style.overflow = document.querySelector('.sidebar.open') ? 'hidden' : '';
}
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
  document.body.style.overflow = '';
}
function esc(str) { return str.replace(/'/g, "\\'").replace(/"/g, '\\"'); }

let APPS_SCRIPT_URL = localStorage.getItem('roofignite_gas_url') || CONFIG.APPS_SCRIPT_URL || '';

// ═══ Greg Configuration State ═══
// Mirrors Greg Apps Script's OWNER_RUN_FLAGS and DISABLED_ACCOUNTS
// Modes per metric: { cpc: 'HARD'|'SOFT'|'OFF', cpl: 'HARD'|'SOFT'|'OFF' }
const gregConfig = {
  managerModes: {},    // { 'Cole': { cpc: 'HARD', cpl: 'SOFT' }, ... }
  accountModes: {},    // { 'Some Account': { cpc: 'OFF', cpl: 'HARD' } } — per-account overrides
  defaultMode: { cpc: 'SOFT', cpl: 'SOFT' }  // Fallback for managers not listed
};

// Helper: normalize a mode value — handles legacy strings + new objects
function normalizeGregMode(val) {
  if (val && typeof val === 'object' && val.cpc) return val;
  const m = (typeof val === 'string') ? val.toUpperCase() : 'SOFT';
  return { cpc: m, cpl: m };
}

function initGregConfig() {
  const managers = getManagers();
  managers.forEach(m => {
    if (!gregConfig.managerModes[m]) gregConfig.managerModes[m] = { ...gregConfig.defaultMode };
  });
}

function getGregMode(accountName, managerName) {
  if (gregConfig.accountModes[accountName]) return normalizeGregMode(gregConfig.accountModes[accountName]);
  return normalizeGregMode(gregConfig.managerModes[managerName] || gregConfig.defaultMode);
}

// Legacy helper: get a single combined mode label for display
function getGregModeLabel(accountName, managerName) {
  const m = getGregMode(accountName, managerName);
  if (m.cpc === m.cpl) return m.cpc;
  return `CPC:${m.cpc} CPL:${m.cpl}`;
}

// Set Greg mode for a manager. metric = 'cpc' | 'cpl' | 'both'
async function setManagerGregMode(manager, mode, metric = 'both') {
  if (!gregConfig.managerModes[manager]) gregConfig.managerModes[manager] = { ...gregConfig.defaultMode };
  const modeObj = gregConfig.managerModes[manager];
  if (metric === 'both' || metric === 'cpc') modeObj.cpc = mode;
  if (metric === 'both' || metric === 'cpl') modeObj.cpl = mode;
  renderAdminView();

  const label = metric === 'both' ? mode : `${metric.toUpperCase()}: ${mode}`;
  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('setManagerGregMode', { manager, cpcMode: modeObj.cpc, cplMode: modeObj.cpl });
    if (result.ok) {
      showToast(`Greg → ${label} for all of ${manager}'s accounts ✓ Saved to Sheet`, mode === 'HARD' ? 'success' : mode === 'SOFT' ? 'warning' : 'info');
    } else {
      showToast(`⚠️ Greg set to ${label} locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`Greg → ${label} for all of ${manager}'s accounts (local only)`, mode === 'HARD' ? 'success' : mode === 'SOFT' ? 'warning' : 'info');
  }
}

// Set Greg mode for a specific account. metric = 'cpc' | 'cpl' | 'both'
async function setAccountGregMode(accountName, mode, metric = 'both') {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const managerMode = normalizeGregMode(gregConfig.managerModes[acct.manager] || gregConfig.defaultMode);

  // Build the target mode object
  let current = gregConfig.accountModes[accountName] ? normalizeGregMode(gregConfig.accountModes[accountName]) : { ...managerMode };
  if (metric === 'both' || metric === 'cpc') current.cpc = mode;
  if (metric === 'both' || metric === 'cpl') current.cpl = mode;

  // If matches manager default, remove the override
  if (current.cpc === managerMode.cpc && current.cpl === managerMode.cpl) {
    delete gregConfig.accountModes[accountName];
  } else {
    gregConfig.accountModes[accountName] = current;
  }
  renderAdminView();

  const isDefault = current.cpc === managerMode.cpc && current.cpl === managerMode.cpl;

function getManagers() {
  const mgrs = new Set();
  allAccounts.forEach(a => { if (a.manager) mgrs.add(a.manager); });
  // Also include managers from gregConfig that may have zero accounts yet
  if (gregConfig && gregConfig.managerModes) {
    Object.keys(gregConfig.managerModes).forEach(m => mgrs.add(m));
  }
  return [...mgrs].sort();
}

// Color palette for sidebar manager avatars (cycles through)
const MGR_COLORS = [
  { from: 'blue-500', to: 'blue-600', text: 'blue-400', border: 'blue-500' },
  { from: 'emerald-500', to: 'emerald-600', text: 'emerald-400', border: 'emerald-500' },
  { from: 'purple-500', to: 'purple-600', text: 'purple-400', border: 'purple-500' },
  { from: 'amber-500', to: 'amber-600', text: 'amber-400', border: 'amber-500' },
  { from: 'rose-500', to: 'rose-600', text: 'rose-400', border: 'rose-500' },
  { from: 'cyan-500', to: 'cyan-600', text: 'cyan-400', border: 'cyan-500' },
  { from: 'indigo-500', to: 'indigo-600', text: 'indigo-400', border: 'indigo-500' },
  { from: 'teal-500', to: 'teal-600', text: 'teal-400', border: 'teal-500' },

function renderSidebarManagers() {
  const container = document.getElementById('sidebar-managers');
  if (!container) return;
  const managers = getManagers();
  container.innerHTML = managers.map((m, idx) => {
    const c = MGR_COLORS[idx % MGR_COLORS.length];
    const initial = m.charAt(0).toUpperCase();
    const key = m.toLowerCase().replace(/\s+/g, '-');
    const acctCount = allAccounts.filter(a => a.manager === m).length;
    return `
      <a href="dashboard.html?view=manager&param=${encodeURIComponent(m)}" id="nav-mgr-${key}" class="nav-item w-full flex items-center gap-3 px-4 py-2.5 text-sm text-dark-200 hover:text-white transition-all cursor-pointer">
        <div class="w-6 h-6 rounded-full bg-gradient-to-br from-${c.from}/20 to-${c.to}/20 flex items-center justify-center text-[10px] font-bold text-${c.text} border border-${c.border}/20">${initial}</div>
        <span class="font-medium">${m}</span>
        <span class="ml-auto text-[10px] text-dark-500">${acctCount}</span>
        <span id="alert-badge-${key}" class="badge badge-red hidden text-[10px]">0</span>
      </a>`;
  }).join('');
}

const POD_COLORS = ['amber', 'cyan', 'indigo', 'teal', 'rose', 'emerald', 'purple', 'blue'];

function renderSidebarPods() {
  const container = document.getElementById('sidebar-pods');
  if (!container) return;
  const podNames = Object.keys(SHEETS).sort((a, b) => {
    const numA = parseInt((a.match(/Pod\s*(\d+)/i) || [])[1]) || 999;
    const numB = parseInt((b.match(/Pod\s*(\d+)/i) || [])[1]) || 999;
    return numA - numB;
  });
  container.innerHTML = podNames.map((name, idx) => {
    const accent = POD_COLORS[idx % POD_COLORS.length];
    const shortLabel = name.replace(/ - RoofIgnite/i, '').replace(/Pod\s*/i, '');
    const podId = 'nav-pod-' + name.replace(/\s+/g, '-');
    return `
      <a href="dashboard.html?view=pod&param=${encodeURIComponent(name)}" id="${podId}" class="nav-item w-full flex items-center gap-3 px-4 py-2.5 text-sm text-dark-200 hover:text-white transition-all cursor-pointer">
        <div class="w-6 h-6 rounded-lg bg-gradient-to-br from-${accent}-500/15 to-${accent}-600/15 flex items-center justify-center text-[10px] font-bold text-${accent}-400 border border-${accent}-500/15">${shortLabel}</div>
        <span class="font-medium">${name.replace(/ - RoofIgnite/i, '')}</span>
      </a>`;
  }).join('');
}

// ═══ Toast Notification ═══

function showToast(message, type = 'info') {
  const colors = { success: 'from-green-500 to-green-600', error: 'from-red-500 to-red-600', warning: 'from-yellow-500 to-yellow-600', info: 'from-blue-500 to-blue-600' };
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-xl md:bottom-6 z-[300] flex items-start gap-3 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-medium bg-gradient-to-r ' + (colors[type] || colors.info);
  toast.style.cssText = 'animation: slideIn 0.3s ease-out; opacity: 0; transform: translateY(20px); word-break: break-word;';
  toast.innerHTML = `<span class="text-lg flex-shrink-0 mt-0.5">${icons[type] || icons.info}</span><span>${message}</span>`;

  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; toast.style.transition = 'all 0.3s'; });
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 3000);
}


// ═══ Google Apps Script Write-Back ═══

// ═══ Blocking progress modal for write operations ═══
const WRITE_ACTION_LABELS = {
  updateCycle:          'Saving cycle changes',
  addCycle:             'Adding new cycle',
  createClient:        'Creating new client',
  updateManager:        'Updating manager',
  transferAccount:      'Transferring account',
  toggleStatus:         'Updating account status',
  updateBilling:        'Saving billing changes',
  setManagerGregMode:   'Updating Greg mode',
  setAccountGregMode:   'Updating Greg mode',
  addManager:           'Adding manager',
  deleteManager:        'Removing manager',
  saveSlackUserId:      'Saving Slack User ID',
  saveSlackGlobalConfig: 'Saving Slack config',
  testSlackWebhook:     'Testing Slack channels',
  saveBillingAdmin:     'Saving billing admin',
  setSlackNotifyToggle: 'Updating notification settings',
  runScript:            'Running report',
  toggleAdStatus:       'Updating ad status',
  createPod:            'Creating new pod',
  deletePod:            'Deleting pod',
};
// Read-only actions that should NOT show the blocking modal
const READ_ONLY_ACTIONS = ['getSheetList', 'getSlackConfig', 'getSlackNotifyToggles', 'getPodRegistry'];

function showWriteProgressModal_(action) {
  const label = WRITE_ACTION_LABELS[action] || 'Saving changes';
  const overlay = document.createElement('div');
  overlay.id = 'write-progress-modal';
  overlay.className = 'fixed inset-0 z-[999] flex items-center justify-center';
  overlay.style.cssText = 'background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-8 max-w-sm w-full mx-4 text-center scale-in" style="border:1px solid rgba(249,115,22,0.2);box-shadow:0 0 40px rgba(249,115,22,0.1);">
      <div class="relative mx-auto mb-5" style="width:48px;height:48px;">
        <div style="width:48px;height:48px;border:3px solid rgba(100,116,139,0.2);border-top-color:#f97316;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      </div>
      <p class="text-white text-sm font-semibold mb-1">${label}...</p>
      <p class="text-dark-400 text-xs">Syncing with Google Sheets — do not close this page</p>
      <div class="mt-4 w-full bg-dark-700/50 rounded-full h-1 overflow-hidden">
        <div class="h-full rounded-full" style="background:linear-gradient(90deg,#f97316,#fb923c);animation:progressPulse 1.5s ease-in-out infinite;width:100%;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function hideWriteProgressModal_() {
  const m = document.getElementById('write-progress-modal');
  if (m) m.remove();
}

async function writeToSheet(action, data, opts = {}) {
  const silent = opts.silent || false; // if true, don't show toasts (caller will handle)
  const isReadOnly = READ_ONLY_ACTIONS.includes(action);
  const showModal = !silent && !isReadOnly && !!APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    console.log('[GAS] No Apps Script URL configured. Action:', action, 'Data:', data);
    if (!silent) showToast('⚠️ Apps Script not connected — changes only saved locally', 'warning');
    return { ok: false, error: 'No Apps Script URL configured' };
  }

  let modal = null;
  if (showModal) modal = showWriteProgressModal_(action);

  try {
    // Use text/plain to avoid CORS preflight, GAS will still parse JSON
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action, ...data }),
      redirect: 'follow'
    });

    // Try to read the response for error details
    let result = { ok: true };
    try {
      const text = await resp.text();
      console.log('[GAS] Raw response for', action, ':', text ? text.substring(0, 200) : '(empty)');
      // GAS sometimes returns HTML on redirect — only parse if it looks like JSON
      if (text && text.trim().startsWith('{')) {
        result = JSON.parse(text);
      }
      // If we got a non-JSON response but HTTP was ok, treat as success
    } catch (_) {
      // If response isn't readable (opaque), assume success if no network error
    }

    if (modal) hideWriteProgressModal_();

    if (result.ok) {
      console.log('[GAS] Write success:', action);
      return result;
    } else {
      const errMsg = result.error || 'Unknown error from Apps Script';
      console.error('[GAS] Write error:', action, errMsg);
      if (!silent) showToast(`❌ Failed to save "${action}" to Sheet: ${errMsg}`, 'error');
      return { ok: false, error: errMsg };
    }

  } catch (e) {
    if (modal) hideWriteProgressModal_();
    console.error('[GAS] Write failed:', action, e);
    if (!silent) showToast(`❌ Could not reach Apps Script — ${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
}

function showAppsScriptSetup() {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto modal-inner" onclick="event.stopPropagation()">
      <h2 class="text-lg font-bold text-white mb-4">🔧 Apps Script Setup — Dashboard Write-Back + Greg Config</h2>
      <div class="text-sm text-dark-200 space-y-3">
        <p class="text-yellow-300 text-xs font-semibold">Two things to set up:</p>

        <p><strong class="text-white">1. Create a "Greg Config" sheet tab</strong> in your Google Sheet with columns:</p>
        <div class="bg-dark-900 rounded-lg p-3 text-[11px] font-mono text-blue-300 overflow-x-auto">Type | Name | Mode
manager | Cole | HARD
manager | Tyler | SOFT
manager | Jonathan | OFF
account | Some Account Name | OFF</div>
        <p class="text-[11px] text-dark-400">The Greg script will read this tab instead of hardcoded OWNER_RUN_FLAGS. "manager" rows set per-manager mode; "account" rows override individual accounts.</p>

        <p><strong class="text-white">2. Deploy this Apps Script</strong> (Extensions → Apps Script → Deploy → Web app):</p>
        <div class="bg-dark-900 rounded-xl p-4 mt-2 mb-4 text-[10px] font-mono text-green-400 overflow-x-auto whitespace-pre">function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  // Greg mode changes → write to "Greg Config" tab (4-column: Type | Name | CPC Mode | CPL Mode)
  if (action === 'setManagerGregMode' || action === 'setAccountGregMode') {
    let configSheet = ss.getSheetByName('Greg Config');
    if (!configSheet) {
      configSheet = ss.insertSheet('Greg Config');
      configSheet.appendRow(['Type', 'Name', 'CPC Mode', 'CPL Mode']);
    }
    const type = action === 'setManagerGregMode' ? 'manager' : 'account';
    const name = data.manager || data.name;
    const cpcMode = data.cpcMode;
    const cplMode = data.cplMode;

    // Find existing row or append
    const vals = configSheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i &lt; vals.length; i++) {
      if (vals[i][0] === type &amp;&amp; vals[i][1] === name) {
        if (cpcMode === null) { configSheet.deleteRow(i + 1); } // remove override
        else { configSheet.getRange(i + 1, 3, 1, 2).setValues([[cpcMode, cplMode]]); }
        found = true; break;
      }
    }
    if (!found &amp;&amp; cpcMode !== null) configSheet.appendRow([type, name, cpcMode, cplMode]);
  }

  // Client CRUD operations
  if (action === 'createClient') {
    const sheet = ss.getSheetByName(data.pod || getPodNames()[0]);
    if (sheet) sheet.appendRow([data.name, '', data.adAccountId||'',
      '', '', data.gregGoal||'', data.bookedGoal||'', '', '', '',
      '', '', '', data.dailyBudget||'', data.monthlyBudget||'']);
  }

  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}</div>

        <p><strong class="text-white">3. Update Greg script</strong> to read config from sheet instead of hardcoded constants:</p>
        <div class="bg-dark-900 rounded-xl p-4 mt-2 mb-4 text-[10px] font-mono text-amber-300 overflow-x-auto whitespace-pre">// Replace OWNER_RUN_FLAGS and DISABLED_ACCOUNTS in Greg script with:
function loadGregConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('Greg Config');
  const flags = {}; const disabled = [];
  if (configSheet) {
    const vals = configSheet.getDataRange().getValues();
    for (let i = 1; i &lt; vals.length; i++) {
      const [type, name, mode] = vals[i];
      if (type === 'manager') flags[name] = mode;
      if (type === 'account' &amp;&amp; mode === 'OFF') disabled.push(name);
    }
  }
  return { ownerRunFlags: flags, disabledAccounts: disabled };
}

// In your main Greg function, replace:
//   const mode = OWNER_RUN_FLAGS[owner] || DEFAULT_OWNER_MODE;
// With:
//   const config = loadGregConfig();
//   const mode = config.ownerRunFlags[owner] || DEFAULT_OWNER_MODE;
//   const DISABLED_ACCOUNTS = config.disabledAccounts;</div>

        <div class="flex gap-3 items-center mt-4">
          <input id="gas-url-input" type="text" placeholder="Paste Apps Script web app URL..." value="${APPS_SCRIPT_URL || ''}" class="flex-1 bg-dark-800 border border-dark-600 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
          <button onclick="const u=document.getElementById('gas-url-input').value.trim();if(u){APPS_SCRIPT_URL=u;localStorage.setItem('roofignite_gas_url',u);showToast('Apps Script connected!','success');this.closest('.fixed').remove();renderAdminView();}else{showToast('Please paste a URL','error');}" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-all">Connect</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ═══════════════════════════════════════════════
// AUTH — Google Sign-In Gate (@roofignite.com only)
// ═══════════════════════════════════════════════
const AUTH_STORAGE_KEY = 'roofignite_user';
const AUTH_TTL_DAYS = 30;
const ALLOWED_DOMAIN = 'roofignite.com';

function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch { return null; }
}

function checkExistingSession() {
  // Auth bypassed for testing — auto-login as dev user
  onAuthSuccess({ name: 'Dev User', email: 'dev@roofignite.com', picture: '' }, false);
  return true;
}

function showLoginGate() {
  document.getElementById('login-gate').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-loading').classList.add('hidden');

  // Initialize Google Sign-In button (wait for GIS library to load)
  const clientId = CONFIG.GOOGLE_CLIENT_ID;
  if (!clientId) {
    document.getElementById('login-error').textContent = 'Google Client ID not configured. Add it in config.js';
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }

  let gisRetries = 0;
  function initGoogleBtn() {
    if (typeof google === 'undefined' || !google.accounts) {
      gisRetries++;
      if (gisRetries > 50) {
        // GIS failed to load after ~5 seconds — show fallback
        console.error('Google Identity Services failed to load after 5s');
        const btnContainer = document.getElementById('google-signin-btn');
        btnContainer.innerHTML = `
          <button onclick="window.location.reload()" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;padding:12px 32px;border-radius:9999px;font-size:14px;font-weight:600;cursor:pointer;">
            Google Sign-In unavailable — Click to retry
          </button>`;
        const errEl = document.getElementById('login-error');
        errEl.textContent = 'Google Sign-In library failed to load. Check your internet connection or try disabling ad blockers.';
        errEl.classList.remove('hidden');
        return;
      }
      setTimeout(initGoogleBtn, 100);
      return;
    }
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleSignIn,
      auto_select: false,
    });
    google.accounts.id.renderButton(
      document.getElementById('google-signin-btn'),
      { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 }
    );
  }
  initGoogleBtn();
}

function handleGoogleSignIn(response) {
  const payload = decodeJwt(response.credential);
  if (!payload || !payload.email) {
    document.getElementById('login-error').textContent = 'Could not read account info. Try again.';
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }

  const emailDomain = payload.email.split('@')[1]?.toLowerCase();
  if (emailDomain !== ALLOWED_DOMAIN) {
    document.getElementById('login-error').innerHTML = `<strong>${payload.email}</strong> is not a @roofignite.com account. Access denied.`;
    document.getElementById('login-error').classList.remove('hidden');
    return;
  }

  // Valid roofignite.com account — save session
  const user = {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture || '',
    timestamp: Date.now()
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  onAuthSuccess(user, true);
}

function onAuthSuccess(user, freshLogin) {
  // Hide login gate, show app
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Update sidebar user info
  const userSection = document.getElementById('sidebar-user');
  if (userSection) {
    userSection.classList.remove('hidden');
    document.getElementById('sidebar-user-name').textContent = user.name;
    document.getElementById('sidebar-user-email').textContent = user.email;
    const pic = document.getElementById('sidebar-user-pic');
    if (user.picture) { pic.src = user.picture; } else { pic.classList.add('hidden'); }
  }

  // v2: Don't auto-call loadAllData here — each page's init script handles it
  // This prevents double-loading since the page DOMContentLoaded also calls loadAllData
}

function handleSignOut() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  // Revoke Google session
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
  // Reset app state
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('google-signin-btn').innerHTML = '';
  showLoginGate();

// ═══════════════════════════════════════════════
// MOBILE: Chart resize on window resize / sidebar toggle
// ═══════════════════════════════════════════════
(function() {
  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      // Resize all active Chart.js instances
      Chart.helpers?.each?.(Chart.instances, function(chart) { chart.resize(); });
      // Fallback: iterate if helpers not available
      if (!Chart.helpers?.each && typeof Chart.instances === 'object') {
        Object.values(Chart.instances).forEach(function(chart) { try { chart.resize(); } catch(e){} });
      }
    }, 250);
  });
})();

// ═══════════════════════════════════════════════
// MOBILE: Scroll focused inputs into view (virtual keyboard)
// ═══════════════════════════════════════════════
(function() {
  if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return;
  document.addEventListener('focusin', function(e) {
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      setTimeout(function() {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });
})();

// ═══════════════════════════════════════════════
// NAVIGATION (v2 - page-based)
// ═══════════════════════════════════════════════
function navigateTo(page, params = {}) {
  const query = new URLSearchParams(params).toString();
  window.location = page + (query ? '?' + query : '');
}

function navigateToAccountPage(val) {
  if (!val) return;
  const [name, adId] = val.split('|||');
  navigateTo('account.html', { name, adAccountId: adId || '' });
}

// Override the old navigate() for backwards compat within shared code
function navigate(view, param) {
  switch(view) {
    case 'dashboard': navigateTo('dashboard.html'); break;
    case 'pod': navigateTo('dashboard.html', { view: 'pod', param }); break;
    case 'manager': navigateTo('dashboard.html', { view: 'manager', param }); break;
    case 'account': navigateTo('account.html', { name: param.name, adAccountId: param.adAccountId || '' }); break;
    case 'billing': navigateTo('billing.html'); break;
    case 'admin': navigateTo('admin.html'); break;
    case 'donttouch': navigateTo('donttouch.html'); break;
    default: navigateTo('dashboard.html'); break;
  }
}

function navigateToAccount(val) {
  navigateToAccountPage(val);
}

// Shared page initialization
async function initPage(renderFn) {
  const authed = checkExistingSession();
  if (!authed) return false;
  await loadAllData();
  if (renderFn) renderFn();
  return true;
}

// Override refreshData for page-based nav
async function refreshDataV2() {
  _refreshBusy = true;
  try {
    await loadAllData({ skipNavRestore: true });
    _lastRefreshTime = Date.now();
    showToast('Data refreshed', 'success');
  } catch(e) {
    showToast('Refresh failed: ' + e.message, 'error');
  }
  _refreshBusy = false;
}
