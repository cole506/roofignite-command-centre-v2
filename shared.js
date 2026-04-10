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
      `style="color:#d4a843;font-size:11px;font-weight:600;background:none;border:none;cursor:pointer;padding:4px 0;margin-top:2px;">Show more</button>` +
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
      <div style="display:inline-block;background:rgba(212,168,67,0.15);color:#fdba74;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;">${escHtml(copy.cta)}</div>
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

const DATA_CACHE_KEY = 'roofignite_data_cache';
const DATA_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function saveDataCache() {
  try {
    sessionStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      allAccounts, allCycles, allLeads, managerPodMap, SHEETS
    }));
  } catch(e) { /* sessionStorage full or unavailable */ }
}

function loadDataCache() {
  try {
    const raw = sessionStorage.getItem(DATA_CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.ts > DATA_CACHE_TTL) return false;
    allAccounts = cached.allAccounts;
    allCycles = cached.allCycles;
    allLeads = cached.allLeads;
    managerPodMap = cached.managerPodMap;
    if (cached.SHEETS) Object.assign(SHEETS, cached.SHEETS);
    return true;
  } catch(e) { return false; }
}

async function loadAllData(opts) {
  const silent = opts && opts.silent;
  if (!silent) document.getElementById('loading-state')?.classList.remove('hidden');

  // v2: Try loading from sessionStorage cache for instant page transitions
  if (!opts?.forceRefresh && loadDataCache()) {
    console.log('[Cache] Loaded data from sessionStorage cache');
    // Populate sidebar and account dropdown from cache
    renderSidebarManagers();
    renderSidebarPods();
    // Populate account dropdown
    const sel = document.getElementById('account-select');
    if (sel) {
      const active = allAccounts.filter(a => a.cycles && a.cycles.some(c => c.cycleEndDate >= getTodayStr())).sort((a,b) => a.name.localeCompare(b.name));
      const inactive = allAccounts.filter(a => !active.includes(a)).sort((a,b) => a.name.localeCompare(b.name));
      sel.innerHTML = '<option value="">Search accounts…</option>'
        + active.map(a => `<option value="${a.name}|||${a.adAccountId||''}">${a.name}</option>`).join('')
        + (inactive.length ? '<optgroup label="── Inactive ──">' + inactive.map(a => `<option value="${a.name}|||${a.adAccountId||''}">${a.name}</option>`).join('') + '</optgroup>' : '');
    }
    if (!silent) document.getElementById('loading-state')?.classList.add('hidden');
    // Refresh data in background (silently update cache for next navigation)
    setTimeout(() => loadAllData({ silent: true, forceRefresh: true }), 100);
    return;
  }

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

  if (!silent) document.getElementById('loading-state')?.classList.add('hidden');

  // v2: Save to cache for instant page transitions
  saveDataCache();
  console.log('[Cache] Data saved to sessionStorage');
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
  if (score >= 40) return { bg: 'rgba(212,168,67,0.2)', text: '#d4a843' };
  return { bg: 'rgba(239,68,68,0.2)', text: '#ef4444' };
}

// Fatigue Score Color (higher = worse, inverse of health)
// Green (0-39), Yellow (40-59), Orange (60-79), Red (80-100)
function fatigueScoreColor(score) {
  if (score === null || score === undefined) return { bg: 'rgba(100,116,139,0.2)', text: '#94a3b8' };
  if (score >= 80) return { bg: 'rgba(239,68,68,0.2)', text: '#ef4444' };
  if (score >= 60) return { bg: 'rgba(212,168,67,0.2)', text: '#d4a843' };
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

// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════
function navigate(view, param) {
  closeSidebar();

  // Clean up any open modals (prevents orphaned overlays)
  document.querySelectorAll('.fixed.inset-0').forEach(m => {
    // Don't remove the write-progress modal — it's protecting an in-flight save
    if (m.id === 'write-progress-modal') return;
    // Don't remove the sidebar overlay or login screen
    if (m.id === 'sidebar-overlay' || m.id === 'login-screen') return;
    m.remove();
  });

  // Flush any pending debounced billing notes save
  if (_billingNotesTimeout) {
    const pendingFn = _billingNotesPendingSave;
    clearTimeout(_billingNotesTimeout);
    _billingNotesTimeout = null;
    if (typeof pendingFn === 'function') pendingFn();
  }

  document.querySelectorAll('[id^="view-"]').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  currentView = view;

  // Persist navigation state so refreshes/auto-refresh restore the same view
  try { localStorage.setItem('nav_state', JSON.stringify({ view, param: param || null })); } catch(e) {}

  // Smooth scroll to top on view change
  document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });

  switch(view) {
    case 'dashboard':
      document.getElementById('nav-dashboard').classList.add('active');
      renderDashboard();
      break;
    case 'pod':
      currentPod = param;
      const podNavId = 'nav-pod-' + param.replace(/\s+/g, '-');
      const podNavEl = document.getElementById(podNavId);
      if (podNavEl) podNavEl.classList.add('active');
      renderPodView(param);
      break;
    case 'manager':
      currentManager = param;
      const navId = 'nav-mgr-' + param.toLowerCase().replace(/\s+/g, '-');
      const navEl = document.getElementById(navId);
      if (navEl) navEl.classList.add('active');
      renderManagerView(param);
      break;
    case 'account':
      renderAccountDetail(param.name, param.adAccountId);
      break;
    case 'billing':
      document.getElementById('nav-billing').classList.add('active');
      renderBilling();
      break;
    case 'admin':
      document.getElementById('nav-admin').classList.add('active');
      renderAdminView();
      break;
    case 'donttouch':
      document.getElementById('nav-donttouch').classList.add('active');
      renderDontTouch();
      break;
  }

  // Add entrance animation to the active view
  const activeView = document.querySelector('[id^="view-"]:not(.hidden)');
  if (activeView) { activeView.classList.remove('view-container'); void activeView.offsetWidth; activeView.classList.add('view-container'); }
}

function navigateToAccount(val) {
  if (!val) return;
  const [name, adId] = val.split('|||');
  navigate('account', { name, adAccountId: adId });
}

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
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAacAAACBCAYAAABkbXUHAAAACXBIWXMAABCbAAAQmwF0iZxLAAAOhklEQVR4nO3dTYhkWVqH8admSsfS0Uo/IEDEjMYGN2olzFIhoxFcCZWNuHQqR0TEWHQ2uBQqGmbhaqpqEbPtqIUMomAVrlxVJO5E6Ew/Fq6MXLgIadtMQdtxdHIWbwT5UZGdkRHv/Yh7nx8E2R1ZcfLkvXnv/55zzz3n3vn5OcAY2EXXnQAT4OjS13F11bmznWuvLeBRpTUq1+Hs65iL/XdUVWVWtEXsux7Qnb12gIeV1ahc82Nw/hoT+/C0qgrdUZfYd3vEftuusjIb5L17htNKXgOvZq+6HSR7l15tOYHdxQnx9z7ff3XUJfbfPu26mLiLY2BE7MNJpTVZrAccAI8rrsemMpwSvAQGVHuAdIkT2QEG0l2cECe459TjIqNH/C15LN7NIbHdxtVWA4jW0XPch+t670tV16ABngD/Qpzktkr+2VvEQXkEPMVguqttYrtNiGCvyg5xYn2DJ7VV7BLbbkxsy6oMgE9wH6YwnPI8IU5yeyX9vB0MpSwPgWfE9iz75DbAE1qWXWJbDkr+uVtEMD4t+ec2muGU6yHwl0Szvkj7xEHozdVcj4iTTK+En+UJrThPiW1bRk/GfD96cZHMcCrGB0Q3XxH2gY8LKltxgfGGYlvAntCKt0vxATXfjw5aKYDhVJwn5Hcv7GEwlWVEcV18r/CEVoZHFHeRCNFD4n4siOFUrKfkdRF1KfZA01UPiRDJvvIeYIupTI8p5h7UHnEBqoIYTsUbJZbjwIdybZN7YuviPaYqPCW2fZYtvFAsnOFUvG3iPtE6eni1XZUPyDuxFT1QRjcbJJbl84QlMJzKMVjz81U+g6Oc7d/F2QKq9ISci4wtPB5LYTiVY5vV7z1t4UmtavsJZXhCq17GCEynBSuJ4VSeVQ+Msh7q1c0esv7AlnU/r/XtJ5Th8VgSw6k8vZI/p1y9NT7bttng6+oR64++tBejJPeTyztm87svelzMCp3ZfF/15FTEszavuVg+og4Tnma5vLxE9gCS3hqfLWIfnnAxI/emLQNymx0ujsHsWVDm8xiuopdXDQDOuJhZXVcdZYfTKfWYGXgd49nX+Y3PzKG/Pe6+fTKvuF8TXRtNCqTr5gd6l9yHXbtrfLaXVAeIE9oBzR7KPJ59PSD+Xp+Td6G4Tjh1k+oAsR97NO/CIo3dejc7JUbZvaiwDpkPgB4SV6JNDqbLJsTBf5JUXl3mMdyj2cF03Yjc3ph1jqluViWI0DWYvoDhdLtRYll3PTAyu4Pa+IzNKfU4kXeTypkvlNg2I6Kl0SR25d3CcLpd5tVNlWvNtKXFdF0drk67SeVMksrZRFn7scpjcO6w6gpsAsNJTdfWUNZiZS8IqhUZTpKk2jGcJEm1YzhJkmrHcJIk1Y7hJEmqHcNJklQ7hpMkqXYMJ0lS7RhOt8t8onycWJYkNZbhdLtB1RWQpLYxnG7WJSZnzFxczKl0JGkJ2es5ddn8lsYWsdRCESuX1mESUknVWmdNqabqXX8jO5y2yV2cr0mciVgSxMKJ2Ss1N47deuVx/RZJWpLhVB7DSZKWZDiV45B2LxQnSXdiOJVjUHUFJGmTGE7FO8SROZJ0J4ZTsc6A/aorIUmbxnAq1gHea5KkOzOcivMCGFVdCUnaRIZTMV4QrSZJ0gqyZ4houzMilEYV10OSNpotpzwviTmzRhXXQ5I2ni2n9ZwRMz8McOCDJKUxnO7uhHhuaUwEk8tgSFIyw2l5J8S07pNqqyFpw53h8jm3yg6nQxasy1GhI/LWZdom7ilNksqT1E5H1Os8WUtNHxCRPZz7ObEYoSSpQE0PpzHwOrG8bXx+SZIK1/RwgvwwOSCWo5ckFaQN4TQBPkos7yEugSFJhWpDOEHcKzpLLO8J3tCUpMK0JZxOye/eGySXJ0maaUs4QUwrdJxY3i6u1SRJhWhTOEExrSeHlktSsraF0xiHlktS7bUtnCDCJHNwhEPL682WrS5zLswN0cZwmhCj97JsytDybtUVqEiv6gqQN4/aTlI5m2g3qRzntNsQbQwniHA6SSyvqKHlmQfSgPa1Iraox6CVrKv1h7SzG7mNv3PrtTWcTslv7WS2xuYyuyC2iXtuvcQy66xHhPvDpPLWGemZuR+f0Z4LjS3id32WWKbdehuizUtmjIir6qzugkez8kZJ5c0dkzez+iPgDdFqPKKZXRw7s9d2crmTNT6bvZ2fzl6Hs7KbdsLdIvZh1rF5WRP/5hupzeEEcVX2JrG85+QvQJi57Mfc9uz1OLncJhuv8dmiToi7FHMCb7Jx1RXQctrarTc3Bl4mllfEPYFXyeVpNeM1PntK7gPgWs1h1RXQ8toeThCtp8yh5U/JHRk3TixLq5l3g65jlFAPrccLvQ1iOOUPLSe5vFNyW3e6u1FNytB6RlVXQMsznEL20PLH5I6KGySWpbs5I+diw4uMar2keQNHGs1wCkXMWp7ZepoALxLL0/Kek3dSy56dRMs5w2elNo7hdOEVuTdM50PLswzIbd3pdsfktlqLuAjS7fax1bRxDKerimg9ZT0seQrs4ZV3Wc4o5oHlEXbvleklDoTYSIbTVUfUe2j5EXHCNKCKNQ+moq629zGgyvCSekxfpRUYTm/Lvi+QPbTcgCrWMRdTHxVpHwOqSC8wmDaa4fS2U/KHlo+SyzsiAs+HCnO9ppxgmtsH3scLjUxnxDb13t6GM5wWG5A7+GCX/PsXp7Myv4EDJdZ1DLxH3NMr+8b5K+JCw1bU+l4S29J7TA1gON0s+8prlFze5XK7REg5Rc7dvCausneodiaOU6IV9Q7RHWVLanlnxDZ7B0flNYrhdLPsoeVFL+k+Ik6y7wAfYpffTV4T2+cdoqVUp6vsCfE3skWE5ktsFS9yQmyb94ltdcB6s8arhu6dn59DXDVmzG58SLPWC9oBPkks74zy1+HpEb/HFlf3TVNnsz7j4p7R6ey/J2z2EiHd2avHxXIS8/ezlwapi2MuWkHzZUHGxL6cVFKj6O5/mlBO086ThZiHkyRJtWG3niSpdgwnSVLtGE6SpNoxnCRJtWM4SZJqx3CSJNWO4SRJqh3DSZJUO4aTJKl2DCdJUu0YTpKk2jGcJEm1YzhJkmrHcJKqMO3vMO3v3P4PpXYynKSyTfu/QqzpU/baXtLGMJyk8n0b+D/gq1VXRKorw0kq07T/e8CvAj8F/HLFtZFqy3CSyrUPfAZ8DvxitVWR6stwksoy7XeBrwH3iHDqVVkdqc4MJ6k8v0EE0wPgR4Efd8SetJjhJJXnl4CvEAF1jwioP660RlJNGU5Seb4KfEoE1Dykfotpv1dlpaQ6Mpyk8vws8DNcDIgA+C7wV3bvSVfdOz8/r7oOUrNN+38I/Dfw68BvE62mz4h7T/MLxO8C23SGp5XUUaqZ+1VXQGq0aX8L+Cbwb8A/EQ/fQjznNA+oe7P3/gaffZIAu/Wkon0T+EmgC/wa8H2iFfU/REB9Pvv/7wE/x7T/J9VUU6oXw0kq1u8QLaSvAD8BnBM9Ft8D/oMIKLhoPX297ApKdeQ9pyaKm+vPr717QGd4tGa5XWAP2CFaAlmO6AwPVvrktP98Vp+LsmCQeu/m7e05ojMcLfG53wQ+JgZBfAr8GBFC/wn8K/ALwP8TLavPZ68vAbt0hn9/h/oUabV9M+2P86sCrPO3oo3iPadm2gJ2F7y3mrhvMgA+WL1Khdnh6u+6C/SY9vfXDuML17fneMnPvUsE0+eXvp4DU2Iao0Pgy0TLat6C+i/g54Gbw2nx/q2butdPNWe3npYxop7BdJNHwJhpf7/ierxLBNKDS18BvjNrGf07EU5fJlpWD3Cmcgmw5aTbRBfS4wXfOQEmST8lq4Vz2UPg49kDrgcVDdH+O+Abs/9+QAx8+D7wndl7/wz8NHGR+ENEC+pHgH+8pdxTotW1rB1ie8ydsfw2z9o3x0S911XE34pqyHDSbRZ1B75PZ/iq9Jqs5gmwk9zNt6wxMUXRvNV0D/gDOsPJ7Psd4M+JQRD/O3vvHy59f7H4PXpL1yLu/1zuZjuiM1z+8zkO6AzHJf9MbTC79XR39Q6m4wXvVdPNFyHzkgimz4BP6Qz/9NK/+CM6w98nRvL9MHE8Piu1jlJNGU5qmgOiK+3s2vvzbr7RbIBHmfU5JgY8/O2V71y0JD4jBkr8BZ3hn5VYN6m2DCc1Twzz7rG4FfWEaEWVM5dd3Oua1+Xdt74fw/MfAH9NZ/i7pdRJ2gD3nRG5lia33nfQF4v7Mjuz56CujzScd/MdLPW80vp1OZ0dZwOm/Q+BTy599+tE9963C69HtXaY9tct4zTlvmG0nJ1ot36unPfuA2+qq4tu8BHxXJHW1RkezAYEjLg6Ym3ezbcH7Bc+mi/Kn9flW5e+81ELggly7qUdkrN68A6e9+roynnPbj2Vb9rvMe2fX3v1Cvt5MYCjy+Lh14+BI5eskOrFcFI7dIans+HTHy347jbwCdO+0+JINeFzTmqXznBwqZtv+9p3n81acMV387XPh6z/AK37pEXus/hKUtUaV12BRusM56P1Rrw9+8W8m2+vgod2m+yoRg/hTvC8V0fjy/9zn85wUE09pApFy2hv1pU34OpgiXk334d0hmXN/q2yxIiwQcW10C2856R2i/DpsfiZqGdM+69YZ0Z3SSsxnKSLuepeLPjuY6L7T1KJDCfdXbnT/5QjRvMdAO+zeOojSSVytJ5WMZ7NvDBZ4bNdFvf3r1JWvs7w1WywxCtiJgnlyJghArJmiVDtGU76YjGy7YyrrYdHxPLjWQ5rNV1T1GWHaX8APK22Mo2RNdt61iwRqjm79bSMHm93dWU5I2burp8Yyfoexf3ukm5gOOl280lUY22irBP1CfGsSbfW3TTxbE4XeF1tRaR2sVuvmY6IK/7r760uurr2gfkyD901SjtKnIHhgKtDvfOD7uKZqN7snckapV2v7zplrfozy5hp4frfXxZniWiJHwDICgKYDHSW3gAAAABJRU5ErkJggg==" alt="RoofIgnite" class="h-8 w-auto opacity-40 mobile-hide" />
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
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAacAAACBCAYAAABkbXUHAAAACXBIWXMAABCbAAAQmwF0iZxLAAAOhklEQVR4nO3dTYhkWVqH8admSsfS0Uo/IEDEjMYGN2olzFIhoxFcCZWNuHQqR0TEWHQ2uBQqGmbhaqpqEbPtqIUMomAVrlxVJO5E6Ew/Fq6MXLgIadtMQdtxdHIWbwT5UZGdkRHv/Yh7nx8E2R1ZcfLkvXnv/55zzz3n3vn5OcAY2EXXnQAT4OjS13F11bmznWuvLeBRpTUq1+Hs65iL/XdUVWVWtEXsux7Qnb12gIeV1ahc82Nw/hoT+/C0qgrdUZfYd3vEftuusjIb5L17htNKXgOvZq+6HSR7l15tOYHdxQnx9z7ff3XUJfbfPu26mLiLY2BE7MNJpTVZrAccAI8rrsemMpwSvAQGVHuAdIkT2QEG0l2cECe459TjIqNH/C15LN7NIbHdxtVWA4jW0XPch+t670tV16ABngD/Qpzktkr+2VvEQXkEPMVguqttYrtNiGCvyg5xYn2DJ7VV7BLbbkxsy6oMgE9wH6YwnPI8IU5yeyX9vB0MpSwPgWfE9iz75DbAE1qWXWJbDkr+uVtEMD4t+ec2muGU6yHwl0Szvkj7xEHozdVcj4iTTK+En+UJrThPiW1bRk/GfD96cZHMcCrGB0Q3XxH2gY8LKltxgfGGYlvAntCKt0vxATXfjw5aKYDhVJwn5Hcv7GEwlWVEcV18r/CEVoZHFHeRCNFD4n4siOFUrKfkdRF1KfZA01UPiRDJvvIeYIupTI8p5h7UHnEBqoIYTsUbJZbjwIdybZN7YuviPaYqPCW2fZYtvFAsnOFUvG3iPtE6eni1XZUPyDuxFT1QRjcbJJbl84QlMJzKMVjz81U+g6Oc7d/F2QKq9ISci4wtPB5LYTiVY5vV7z1t4UmtavsJZXhCq17GCEynBSuJ4VSeVQ+Msh7q1c0esv7AlnU/r/XtJ5Th8VgSw6k8vZI/p1y9NT7bttng6+oR64++tBejJPeTyztm87svelzMCp3ZfF/15FTEszavuVg+og4Tnma5vLxE9gCS3hqfLWIfnnAxI/emLQNymx0ujsHsWVDm8xiuopdXDQDOuJhZXVcdZYfTKfWYGXgd49nX+Y3PzKG/Pe6+fTKvuF8TXRtNCqTr5gd6l9yHXbtrfLaXVAeIE9oBzR7KPJ59PSD+Xp+Td6G4Tjh1k+oAsR97NO/CIo3dejc7JUbZvaiwDpkPgB4SV6JNDqbLJsTBf5JUXl3mMdyj2cF03Yjc3ph1jqluViWI0DWYvoDhdLtRYll3PTAyu4Pa+IzNKfU4kXeTypkvlNg2I6Kl0SR25d3CcLpd5tVNlWvNtKXFdF0drk67SeVMksrZRFn7scpjcO6w6gpsAsNJTdfWUNZiZS8IqhUZTpKk2jGcJEm1YzhJkmrHcJIk1Y7hJEmqHcNJklQ7hpMkqXYMJ0lS7RhOt8t8onycWJYkNZbhdLtB1RWQpLYxnG7WJSZnzFxczKl0JGkJ2es5ddn8lsYWsdRCESuX1mESUknVWmdNqabqXX8jO5y2yV2cr0mciVgSxMKJ2Ss1N47deuVx/RZJWpLhVB7DSZKWZDiV45B2LxQnSXdiOJVjUHUFJGmTGE7FO8SROZJ0J4ZTsc6A/aorIUmbxnAq1gHea5KkOzOcivMCGFVdCUnaRIZTMV4QrSZJ0gqyZ4houzMilEYV10OSNpotpzwviTmzRhXXQ5I2ni2n9ZwRMz8McOCDJKUxnO7uhHhuaUwEk8tgSFIyw2l5J8S07pNqqyFpw53h8jm3yg6nQxasy1GhI/LWZdom7ilNksqT1E5H1Os8WUtNHxCRPZz7ObEYoSSpQE0PpzHwOrG8bXx+SZIK1/RwgvwwOSCWo5ckFaQN4TQBPkos7yEugSFJhWpDOEHcKzpLLO8J3tCUpMK0JZxOye/eGySXJ0maaUs4QUwrdJxY3i6u1SRJhWhTOEExrSeHlktSsraF0xiHlktS7bUtnCDCJHNwhEPL682WrS5zLswN0cZwmhCj97JsytDybtUVqEiv6gqQN4/aTlI5m2g3qRzntNsQbQwniHA6SSyvqKHlmQfSgPa1Iraox6CVrKv1h7SzG7mNv3PrtTWcTslv7WS2xuYyuyC2iXtuvcQy66xHhPvDpPLWGemZuR+f0Z4LjS3id32WWKbdehuizUtmjIir6qzugkez8kZJ5c0dkzez+iPgDdFqPKKZXRw7s9d2crmTNT6bvZ2fzl6Hs7KbdsLdIvZh1rF5WRP/5hupzeEEcVX2JrG85+QvQJi57Mfc9uz1OLncJhuv8dmiToi7FHMCb7Jx1RXQctrarTc3Bl4mllfEPYFXyeVpNeM1PntK7gPgWs1h1RXQ8toeThCtp8yh5U/JHRk3TixLq5l3g65jlFAPrccLvQ1iOOUPLSe5vFNyW3e6u1FNytB6RlVXQMsznEL20PLH5I6KGySWpbs5I+diw4uMar2keQNHGs1wCkXMWp7ZepoALxLL0/Kek3dSy56dRMs5w2elNo7hdOEVuTdM50PLswzIbd3pdsfktlqLuAjS7fax1bRxDKerimg9ZT0seQrs4ZV3Wc4o5oHlEXbvleklDoTYSIbTVUfUe2j5EXHCNKCKNQ+moq629zGgyvCSekxfpRUYTm/Lvi+QPbTcgCrWMRdTHxVpHwOqSC8wmDaa4fS2U/KHlo+SyzsiAs+HCnO9ppxgmtsH3scLjUxnxDb13t6GM5wWG5A7+GCX/PsXp7Myv4EDJdZ1DLxH3NMr+8b5K+JCw1bU+l4S29J7TA1gON0s+8prlFze5XK7REg5Rc7dvCausneodiaOU6IV9Q7RHWVLanlnxDZ7B0flNYrhdLPsoeVFL+k+Ik6y7wAfYpffTV4T2+cdoqVUp6vsCfE3skWE5ktsFS9yQmyb94ltdcB6s8arhu6dn59DXDVmzG58SLPWC9oBPkks74zy1+HpEb/HFlf3TVNnsz7j4p7R6ey/J2z2EiHd2avHxXIS8/ezlwapi2MuWkHzZUHGxL6cVFKj6O5/mlBO086ThZiHkyRJtWG3niSpdgwnSVLtGE6SpNoxnCRJtWM4SZJqx3CSJNWO4SRJqh3DSZJUO4aTJKl2DCdJUu0YTpKk2jGcJEm1YzhJkmrHcJKqMO3vMO3v3P4PpXYynKSyTfu/QqzpU/baXtLGMJyk8n0b+D/gq1VXRKorw0kq07T/e8CvAj8F/HLFtZFqy3CSyrUPfAZ8DvxitVWR6stwksoy7XeBrwH3iHDqVVkdqc4MJ6k8v0EE0wPgR4Efd8SetJjhJJXnl4CvEAF1jwioP660RlJNGU5Seb4KfEoE1Dykfotpv1dlpaQ6Mpyk8vws8DNcDIgA+C7wV3bvSVfdOz8/r7oOUrNN+38I/Dfw68BvE62mz4h7T/MLxO8C23SGp5XUUaqZ+1VXQGq0aX8L+Cbwb8A/EQ/fQjznNA+oe7P3/gaffZIAu/Wkon0T+EmgC/wa8H2iFfU/REB9Pvv/7wE/x7T/J9VUU6oXw0kq1u8QLaSvAD8BnBM9Ft8D/oMIKLhoPX297ApKdeQ9pyaKm+vPr717QGd4tGa5XWAP2CFaAlmO6AwPVvrktP98Vp+LsmCQeu/m7e05ojMcLfG53wQ+JgZBfAr8GBFC/wn8K/ALwP8TLavPZ68vAbt0hn9/h/oUabV9M+2P86sCrPO3oo3iPadm2gJ2F7y3mrhvMgA+WL1Khdnh6u+6C/SY9vfXDuML17fneMnPvUsE0+eXvp4DU2Iao0Pgy0TLat6C+i/g54Gbw2nx/q2butdPNWe3npYxop7BdJNHwJhpf7/ierxLBNKDS18BvjNrGf07EU5fJlpWD3Cmcgmw5aTbRBfS4wXfOQEmST8lq4Vz2UPg49kDrgcVDdH+O+Abs/9+QAx8+D7wndl7/wz8NHGR+ENEC+pHgH+8pdxTotW1rB1ie8ydsfw2z9o3x0S911XE34pqyHDSbRZ1B75PZ/iq9Jqs5gmwk9zNt6wxMUXRvNV0D/gDOsPJ7Psd4M+JQRD/O3vvHy59f7H4PXpL1yLu/1zuZjuiM1z+8zkO6AzHJf9MbTC79XR39Q6m4wXvVdPNFyHzkgimz4BP6Qz/9NK/+CM6w98nRvL9MHE8Piu1jlJNGU5qmgOiK+3s2vvzbr7RbIBHmfU5JgY8/O2V71y0JD4jBkr8BZ3hn5VYN6m2DCc1Twzz7rG4FfWEaEWVM5dd3Oua1+Xdt74fw/MfAH9NZ/i7pdRJ2gD3nRG5lia33nfQF4v7Mjuz56CujzScd/MdLPW80vp1OZ0dZwOm/Q+BTy599+tE9963C69HtXaY9tct4zTlvmG0nJ1ot36unPfuA2+qq4tu8BHxXJHW1RkezAYEjLg6Ym3ezbcH7Bc+mi/Kn9flW5e+81ELggly7qUdkrN68A6e9+roynnPbj2Vb9rvMe2fX3v1Cvt5MYCjy+Lh14+BI5eskOrFcFI7dIans+HTHy347jbwCdO+0+JINeFzTmqXznBwqZtv+9p3n81acMV387XPh6z/AK37pEXus/hKUtUaV12BRusM56P1Rrw9+8W8m2+vgod2m+yoRg/hTvC8V0fjy/9zn85wUE09pApFy2hv1pU34OpgiXk334d0hmXN/q2yxIiwQcW10C2856R2i/DpsfiZqGdM+69YZ0Z3SSsxnKSLuepeLPjuY6L7T1KJDCfdXbnT/5QjRvMdAO+zeOojSSVytJ5WMZ7NvDBZ4bNdFvf3r1JWvs7w1WywxCtiJgnlyJghArJmiVDtGU76YjGy7YyrrYdHxPLjWQ5rNV1T1GWHaX8APK22Mo2RNdt61iwRqjm79bSMHm93dWU5I2burp8Yyfoexf3ukm5gOOl280lUY22irBP1CfGsSbfW3TTxbE4XeF1tRaR2sVuvmY6IK/7r760uurr2gfkyD901SjtKnIHhgKtDvfOD7uKZqN7snckapV2v7zplrfozy5hp4frfXxZniWiJHwDICgKYDHSW3gAAAABJRU5ErkJggg==" alt="RoofIgnite" class="h-8 w-auto opacity-40 mobile-hide" />
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
          <button onclick="openCreativeForgeModal('${esc(name)}')" class="flex items-center gap-1.5 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold text-dark-200 hover:text-white bg-gradient-to-r from-purple-500/20 to-purple-600/20 hover:from-purple-500/30 hover:to-purple-600/30 border border-purple-500/30 transition-all">
            <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            Creative Forge
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
    { key: 'cpa',      label: 'CPA',      valA: aggA.cpa,      valB: aggB.cpa,      fmt: '$', lower: true,  color: '#d4a843' },
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
        { label: 'CPA', data: cycles.map(c => c.cpa), borderColor: '#d4a843', backgroundColor: 'rgba(212,168,67,0.08)', fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: '#d4a843', pointBorderColor: '#1e293b', pointBorderWidth: 2, borderWidth: 2.5 },
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
// UTILITY
// ═══════════════════════════════════════════════
function esc(str) { return str.replace(/'/g, "\\'").replace(/"/g, '\\"'); }

// ═══════════════════════════════════════════════
// ADMIN: CRUD — Manage Clients
// ═══════════════════════════════════════════════

// Google Apps Script Web App URL for write operations
// Persisted in localStorage so it survives page reloads
let APPS_SCRIPT_URL = localStorage.getItem('roofignite_gas_url') || CONFIG.APPS_SCRIPT_URL || '';

// Admin state
let adminFilter = 'all'; // all, active, paused, manager-X
let adminSearch = '';
let adminEditingAccount = null; // name of account being edited
let adminEditingCycle = null;   // {account, cycleIndex}
let adminShowNewClient = false;
let adminShowNewManager = false;
let adminTab = 'clients'; // 'clients' or 'settings'
let slackConfigCache = null; // cached webhook config from backend

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
  const label = metric === 'both' ? mode : `${metric.toUpperCase()}: ${mode}`;
  if (APPS_SCRIPT_URL) {
    const payload = isDefault
      ? { name: accountName, cpcMode: null, cplMode: null }
      : { name: accountName, cpcMode: current.cpc, cplMode: current.cpl };
    const result = await writeToSheet('setAccountGregMode', payload);
    if (result.ok) {
      const msg = isDefault
        ? `${accountName}: Greg reset to manager default ✓ Saved`
        : `${accountName}: Greg → ${label} ✓ Saved to Sheet`;
      showToast(msg, mode === 'HARD' ? 'success' : mode === 'SOFT' ? 'warning' : 'info');
    } else {
      showToast(`⚠️ ${accountName}: Greg set locally, but failed to save to Sheet`, 'error');
    }
  } else {
    const msg = isDefault
      ? `${accountName}: Greg reset to manager default (local only)`
      : `${accountName}: Greg → ${label} (local only)`;
    showToast(msg, mode === 'HARD' ? 'success' : mode === 'SOFT' ? 'warning' : 'info');
  }
}

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
];

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
      <button onclick="navigate('manager', '${esc(m)}')" id="nav-mgr-${key}" class="nav-item w-full flex items-center gap-3 px-4 py-2.5 text-sm text-dark-200 hover:text-white transition-all">
        <div class="w-6 h-6 rounded-full bg-gradient-to-br from-${c.from}/20 to-${c.to}/20 flex items-center justify-center text-[10px] font-bold text-${c.text}">${initial}</div>
        <span class="font-medium">${m}</span>
        <span class="ml-auto text-[10px] text-dark-500">${acctCount}</span>
        <span id="alert-badge-${key}" class="badge badge-red hidden text-[10px]">0</span>
      </button>`;
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
      <button onclick="navigate('pod', '${esc(name)}')" id="${podId}" class="nav-item w-full flex items-center gap-3 px-4 py-2.5 text-sm text-dark-200 hover:text-white transition-all">
        <div class="w-6 h-6 rounded-lg bg-gradient-to-br from-${accent}-500/15 to-${accent}-600/15 flex items-center justify-center text-[10px] font-bold text-${accent}-400 border border-${accent}-500/15">${shortLabel}</div>
        <span class="font-medium">${name.replace(/ - RoofIgnite/i, '')}</span>
      </button>`;
  }).join('');
}

function getFilteredAdminAccounts() {
  let accts = [...allAccounts];
  if (adminSearch) {
    const q = adminSearch.toLowerCase();
    accts = accts.filter(a => a.name.toLowerCase().includes(q) || a.manager.toLowerCase().includes(q) || (a.section || '').toLowerCase().includes(q));
  }
  if (adminFilter === 'active') accts = accts.filter(a => hasActiveCycle(a) && !a.isPaused);
  else if (adminFilter === 'paused') accts = accts.filter(a => a.isPaused || !hasActiveCycle(a));
  else if (adminFilter.startsWith('manager-')) {
    const mgr = adminFilter.replace('manager-', '');
    accts = accts.filter(a => a.manager === mgr);
  }
  return accts.sort((a, b) => a.manager.localeCompare(b.manager) || a.name.localeCompare(b.name));
}

function renderAdminView() {
  const el = document.getElementById('view-admin');
  el.classList.remove('hidden');

  const managers = getManagers();
  const accts = getFilteredAdminAccounts();
  const hasGAS = !!APPS_SCRIPT_URL;

  // Force scroll to top when admin view renders
  setTimeout(() => { document.querySelector('.main-content')?.scrollTo(0, 0); }, 0);

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5 md:mb-8">
      <div class="flex items-center gap-3 md:gap-4">
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAacAAACBCAYAAABkbXUHAAAACXBIWXMAABCbAAAQmwF0iZxLAAAOhklEQVR4nO3dTYhkWVqH8admSsfS0Uo/IEDEjMYGN2olzFIhoxFcCZWNuHQqR0TEWHQ2uBQqGmbhaqpqEbPtqIUMomAVrlxVJO5E6Ew/Fq6MXLgIadtMQdtxdHIWbwT5UZGdkRHv/Yh7nx8E2R1ZcfLkvXnv/55zzz3n3vn5OcAY2EXXnQAT4OjS13F11bmznWuvLeBRpTUq1+Hs65iL/XdUVWVWtEXsux7Qnb12gIeV1ahc82Nw/hoT+/C0qgrdUZfYd3vEftuusjIb5L17htNKXgOvZq+6HSR7l15tOYHdxQnx9z7ff3XUJfbfPu26mLiLY2BE7MNJpTVZrAccAI8rrsemMpwSvAQGVHuAdIkT2QEG0l2cECe459TjIqNH/C15LN7NIbHdxtVWA4jW0XPch+t670tV16ABngD/Qpzktkr+2VvEQXkEPMVguqttYrtNiGCvyg5xYn2DJ7VV7BLbbkxsy6oMgE9wH6YwnPI8IU5yeyX9vB0MpSwPgWfE9iz75DbAE1qWXWJbDkr+uVtEMD4t+ec2muGU6yHwl0Szvkj7xEHozdVcj4iTTK+En+UJrThPiW1bRk/GfD96cZHMcCrGB0Q3XxH2gY8LKltxgfGGYlvAntCKt0vxATXfjw5aKYDhVJwn5Hcv7GEwlWVEcV18r/CEVoZHFHeRCNFD4n4siOFUrKfkdRF1KfZA01UPiRDJvvIeYIupTI8p5h7UHnEBqoIYTsUbJZbjwIdybZN7YuviPaYqPCW2fZYtvFAsnOFUvG3iPtE6eni1XZUPyDuxFT1QRjcbJJbl84QlMJzKMVjz81U+g6Oc7d/F2QKq9ISci4wtPB5LYTiVY5vV7z1t4UmtavsJZXhCq17GCEynBSuJ4VSeVQ+Msh7q1c0esv7AlnU/r/XtJ5Th8VgSw6k8vZI/p1y9NT7bttng6+oR64++tBejJPeTyztm87svelzMCp3ZfF/15FTEszavuVg+og4Tnma5vLxE9gCS3hqfLWIfnnAxI/emLQNymx0ujsHsWVDm8xiuopdXDQDOuJhZXVcdZYfTKfWYGXgd49nX+Y3PzKG/Pe6+fTKvuF8TXRtNCqTr5gd6l9yHXbtrfLaXVAeIE9oBzR7KPJ59PSD+Xp+Td6G4Tjh1k+oAsR97NO/CIo3dejc7JUbZvaiwDpkPgB4SV6JNDqbLJsTBf5JUXl3mMdyj2cF03Yjc3ph1jqluViWI0DWYvoDhdLtRYll3PTAyu4Pa+IzNKfU4kXeTypkvlNg2I6Kl0SR25d3CcLpd5tVNlWvNtKXFdF0drk67SeVMksrZRFn7scpjcO6w6gpsAsNJTdfWUNZiZS8IqhUZTpKk2jGcJEm1YzhJkmrHcJIk1Y7hJEmqHcNJklQ7hpMkqXYMJ0lS7RhOt8t8onycWJYkNZbhdLtB1RWQpLYxnG7WJSZnzFxczKl0JGkJ2es5ddn8lsYWsdRCESuX1mESUknVWmdNqabqXX8jO5y2yV2cr0mciVgSxMKJ2Ss1N47deuVx/RZJWpLhVB7DSZKWZDiV45B2LxQnSXdiOJVjUHUFJGmTGE7FO8SROZJ0J4ZTsc6A/aorIUmbxnAq1gHea5KkOzOcivMCGFVdCUnaRIZTMV4QrSZJ0gqyZ4houzMilEYV10OSNpotpzwviTmzRhXXQ5I2ni2n9ZwRMz8McOCDJKUxnO7uhHhuaUwEk8tgSFIyw2l5J8S07pNqqyFpw53h8jm3yg6nQxasy1GhI/LWZdom7ilNksqT1E5H1Os8WUtNHxCRPZz7ObEYoSSpQE0PpzHwOrG8bXx+SZIK1/RwgvwwOSCWo5ckFaQN4TQBPkos7yEugSFJhWpDOEHcKzpLLO8J3tCUpMK0JZxOye/eGySXJ0maaUs4QUwrdJxY3i6u1SRJhWhTOEExrSeHlktSsraF0xiHlktS7bUtnCDCJHNwhEPL682WrS5zLswN0cZwmhCj97JsytDybtUVqEiv6gqQN4/aTlI5m2g3qRzntNsQbQwniHA6SSyvqKHlmQfSgPa1Iraox6CVrKv1h7SzG7mNv3PrtTWcTslv7WS2xuYyuyC2iXtuvcQy66xHhPvDpPLWGemZuR+f0Z4LjS3id32WWKbdehuizUtmjIir6qzugkez8kZJ5c0dkzez+iPgDdFqPKKZXRw7s9d2crmTNT6bvZ2fzl6Hs7KbdsLdIvZh1rF5WRP/5hupzeEEcVX2JrG85+QvQJi57Mfc9uz1OLncJhuv8dmiToi7FHMCb7Jx1RXQctrarTc3Bl4mllfEPYFXyeVpNeM1PntK7gPgWs1h1RXQ8toeThCtp8yh5U/JHRk3TixLq5l3g65jlFAPrccLvQ1iOOUPLSe5vFNyW3e6u1FNytB6RlVXQMsznEL20PLH5I6KGySWpbs5I+diw4uMar2keQNHGs1wCkXMWp7ZepoALxLL0/Kek3dSy56dRMs5w2elNo7hdOEVuTdM50PLswzIbd3pdsfktlqLuAjS7fax1bRxDKerimg9ZT0seQrs4ZV3Wc4o5oHlEXbvleklDoTYSIbTVUfUe2j5EXHCNKCKNQ+moq629zGgyvCSekxfpRUYTm/Lvi+QPbTcgCrWMRdTHxVpHwOqSC8wmDaa4fS2U/KHlo+SyzsiAs+HCnO9ppxgmtsH3scLjUxnxDb13t6GM5wWG5A7+GCX/PsXp7Myv4EDJdZ1DLxH3NMr+8b5K+JCw1bU+l4S29J7TA1gON0s+8prlFze5XK7REg5Rc7dvCausneodiaOU6IV9Q7RHWVLanlnxDZ7B0flNYrhdLPsoeVFL+k+Ik6y7wAfYpffTV4T2+cdoqVUp6vsCfE3skWE5ktsFS9yQmyb94ltdcB6s8arhu6dn59DXDVmzG58SLPWC9oBPkks74zy1+HpEb/HFlf3TVNnsz7j4p7R6ey/J2z2EiHd2avHxXIS8/ezlwapi2MuWkHzZUHGxL6cVFKj6O5/mlBO086ThZiHkyRJtWG3niSpdgwnSVLtGE6SpNoxnCRJtWM4SZJqx3CSJNWO4SRJqh3DSZJUO4aTJKl2DCdJUu0YTpKk2jGcJEm1YzhJkmrHcJKqMO3vMO3v3P4PpXYynKSyTfu/QqzpU/baXtLGMJyk8n0b+D/gq1VXRKorw0kq07T/e8CvAj8F/HLFtZFqy3CSyrUPfAZ8DvxitVWR6stwksoy7XeBrwH3iHDqVVkdqc4MJ6k8v0EE0wPgR4Efd8SetJjhJJXnl4CvEAF1jwioP660RlJNGU5Seb4KfEoE1Dykfotpv1dlpaQ6Mpyk8vws8DNcDIgA+C7wV3bvSVfdOz8/r7oOUrNN+38I/Dfw68BvE62mz4h7T/MLxO8C23SGp5XUUaqZ+1VXQGq0aX8L+Cbwb8A/EQ/fQjznNA+oe7P3/gaffZIAu/Wkon0T+EmgC/wa8H2iFfU/REB9Pvv/7wE/x7T/J9VUU6oXw0kq1u8QLaSvAD8BnBM9Ft8D/oMIKLhoPX297ApKdeQ9pyaKm+vPr717QGd4tGa5XWAP2CFaAlmO6AwPVvrktP98Vp+LsmCQeu/m7e05ojMcLfG53wQ+JgZBfAr8GBFC/wn8K/ALwP8TLavPZ68vAbt0hn9/h/oUabV9M+2P86sCrPO3oo3iPadm2gJ2F7y3mrhvMgA+WL1Khdnh6u+6C/SY9vfXDuML17fneMnPvUsE0+eXvp4DU2Iao0Pgy0TLat6C+i/g54Gbw2nx/q2butdPNWe3npYxop7BdJNHwJhpf7/ierxLBNKDS18BvjNrGf07EU5fJlpWD3Cmcgmw5aTbRBfS4wXfOQEmST8lq4Vz2UPg49kDrgcVDdH+O+Abs/9+QAx8+D7wndl7/wz8NHGR+ENEC+pHgH+8pdxTotW1rB1ie8ydsfw2z9o3x0S911XE34pqyHDSbRZ1B75PZ/iq9Jqs5gmwk9zNt6wxMUXRvNV0D/gDOsPJ7Psd4M+JQRD/O3vvHy59f7H4PXpL1yLu/1zuZjuiM1z+8zkO6AzHJf9MbTC79XR39Q6m4wXvVdPNFyHzkgimz4BP6Qz/9NK/+CM6w98nRvL9MHE8Piu1jlJNGU5qmgOiK+3s2vvzbr7RbIBHmfU5JgY8/O2V71y0JD4jBkr8BZ3hn5VYN6m2DCc1Twzz7rG4FfWEaEWVM5dd3Oua1+Xdt74fw/MfAH9NZ/i7pdRJ2gD3nRG5lia33nfQF4v7Mjuz56CujzScd/MdLPW80vp1OZ0dZwOm/Q+BTy599+tE9963C69HtXaY9tct4zTlvmG0nJ1ot36unPfuA2+qq4tu8BHxXJHW1RkezAYEjLg6Ym3ezbcH7Bc+mi/Kn9flW5e+81ELggly7qUdkrN68A6e9+roynnPbj2Vb9rvMe2fX3v1Cvt5MYCjy+Lh14+BI5eskOrFcFI7dIans+HTHy347jbwCdO+0+JINeFzTmqXznBwqZtv+9p3n81acMV387XPh6z/AK37pEXus/hKUtUaV12BRusM56P1Rrw9+8W8m2+vgod2m+yoRg/hTvC8V0fjy/9zn85wUE09pApFy2hv1pU34OpgiXk334d0hmXN/q2yxIiwQcW10C2856R2i/DpsfiZqGdM+69YZ0Z3SSsxnKSLuepeLPjuY6L7T1KJDCfdXbnT/5QjRvMdAO+zeOojSSVytJ5WMZ7NvDBZ4bNdFvf3r1JWvs7w1WywxCtiJgnlyJghArJmiVDtGU76YjGy7YyrrYdHxPLjWQ5rNV1T1GWHaX8APK22Mo2RNdt61iwRqjm79bSMHm93dWU5I2burp8Yyfoexf3ukm5gOOl280lUY22irBP1CfGsSbfW3TTxbE4XeF1tRaR2sVuvmY6IK/7r760uurr2gfkyD901SjtKnIHhgKtDvfOD7uKZqN7snckapV2v7zplrfozy5hp4frfXxZniWiJHwDICgKYDHSW3gAAAABJRU5ErkJggg==" alt="RoofIgnite" class="h-10 w-auto mobile-hide" />
        <div>
          <h1 class="text-xl md:text-2xl lg:text-3xl font-extrabold text-white tracking-tight">Manage</h1>
          <p class="text-dark-300 text-xs md:text-sm mt-1">${allAccounts.length} clients · ${managers.length} managers</p>
        </div>
      </div>
      <div class="flex gap-2 md:gap-3 flex-wrap">
        <button onclick="openTransferModal()" class="flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/20">
          <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
          Transfer
        </button>
        <button onclick="adminShowNewManager=true;renderAdminView()" class="flex items-center gap-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/20">
          <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          <span class="mobile-hide">New</span> Mgr
        </button>
        <button onclick="openNewClientModal()" class="flex items-center gap-1.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-all shadow-lg shadow-brand-500/20">
          <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
          <span class="mobile-hide">New</span> Client
        </button>
        <button onclick="showPodSettingsModal()" class="flex items-center gap-1.5 bg-gradient-to-r from-teal-500 to-cyan-600 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg shadow-teal-500/20">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
          <span class="mobile-hide">Pod</span> Settings
        </button>
        <button onclick="refreshData()" class="flex items-center gap-1.5 bg-dark-700/60 text-dark-200 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-medium hover:bg-dark-600/60 border border-dark-600/50 transition-all">
          <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          <span class="mobile-hide">Refresh</span>
        </button>
        <button onclick="showAppsScriptSetup()" class="flex items-center gap-1.5 bg-dark-700/60 text-dark-200 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-medium hover:bg-dark-600/60 border border-dark-600/50 transition-all mobile-hide" title="Apps Script Settings">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>

    <!-- Tab Switcher -->
    <div class="flex flex-wrap gap-2 mb-6 bg-dark-800/60 rounded-xl p-1 border border-dark-600/30 w-fit">
      <button onclick="adminTab='clients';renderAdminView()" class="px-5 py-2 rounded-xl text-xs font-semibold transition-all ${adminTab === 'clients' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-transparent text-dark-400 border border-transparent hover:text-white'}">
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          Clients
        </span>
      </button>
      <button onclick="adminTab='settings';loadSlackConfig().then(()=>renderAdminView())" class="px-5 py-2 rounded-xl text-xs font-semibold transition-all ${adminTab === 'settings' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-transparent text-dark-400 border border-transparent hover:text-white'}">
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
          Settings
        </span>
      </button>
    </div>

    ${adminTab === 'settings' ? renderSettingsTab(managers) : ''}

    ${adminTab === 'clients' ? `
    ${!hasGAS ? `
    <div class="glass rounded-2xl p-5 mb-6 border-l-4 border-yellow-500/60">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
        <div>
          <p class="text-yellow-300 font-semibold text-sm">Write Access Not Configured</p>
          <p class="text-dark-300 text-xs mt-1">Changes are saved locally until you connect a Google Apps Script. To enable write-back to your Google Sheet, deploy the Apps Script web app and paste the URL in the dashboard code.</p>
          <button onclick="adminTab='settings';renderAdminView()" class="mt-2 text-yellow-400 hover:text-yellow-300 text-xs font-medium underline">Go to Settings</button>
        </div>
      </div>
    </div>` : ''}

    ${adminShowNewManager ? renderNewManagerForm() : ''}
    ${adminShowNewClient ? renderNewClientForm(managers) : ''}
    <!-- New Client Modal rendered separately -->

    <!-- Greg Control Center -->
    <div class="glass rounded-2xl p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <span class="w-6 h-6 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-600/20 border border-green-500/20 flex items-center justify-center text-[10px]">🤖</span>
          Greg Control Center
        </h3>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-dark-400 mobile-hide">
          <span class="w-2 h-2 rounded-full bg-green-500"></span> HARD = pauses ads
          <span class="w-2 h-2 rounded-full bg-yellow-500 ml-2"></span> SOFT = alerts only
          <span class="w-2 h-2 rounded-full bg-dark-500 ml-2"></span> OFF = disabled
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-${Math.min(managers.length, 5)} gap-3">
        ${managers.map(m => {
          const modeObj = normalizeGregMode(gregConfig.managerModes[m] || gregConfig.defaultMode);
          const acctCount = allAccounts.filter(a => a.manager === m).length;
          const overrideCount = allAccounts.filter(a => a.manager === m && gregConfig.accountModes[a.name]).length;
          function mgrToggle(metric, current) {
            return ['OFF','SOFT','HARD'].map(function(md) {
              var cls = current === md
                ? (md === 'HARD' ? 'bg-green-500/30 text-green-300' : md === 'SOFT' ? 'bg-yellow-500/30 text-yellow-300' : 'bg-dark-600/60 text-dark-300')
                : 'text-dark-500 hover:text-dark-200 hover:bg-dark-700/40';
              return '<button onclick="setManagerGregMode(\'' + esc(m) + '\',\'' + md + '\',\'' + metric + '\')" class="flex-1 py-1 text-[9px] font-bold transition-all ' + cls + '">' + md + '</button>';
            }).join('');
          }
          return `
          <div class="bg-dark-800/60 rounded-xl p-3 border border-dark-600/30">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-white">${m}</span>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-dark-400">${acctCount} accts</span>
                <button onclick="confirmDeleteManager('${esc(m)}',${acctCount})" class="text-dark-500 hover:text-red-400 transition-colors p-0.5" title="Remove Manager">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>
            <div class="space-y-1.5">
              <div>
                <span class="text-[9px] text-dark-400 uppercase tracking-wider">CPC</span>
                <div class="flex rounded-lg overflow-hidden border border-dark-600/40 mt-0.5">
                  ${mgrToggle('cpc', modeObj.cpc)}
                </div>
              </div>
              <div>
                <span class="text-[9px] text-dark-400 uppercase tracking-wider">CPL</span>
                <div class="flex rounded-lg overflow-hidden border border-dark-600/40 mt-0.5">
                  ${mgrToggle('cpl', modeObj.cpl)}
                </div>
              </div>
            </div>
            ${overrideCount > 0 ? `<div class="text-[9px] text-brand-400 mt-1.5">${overrideCount} account override${overrideCount > 1 ? 's' : ''}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>


    <!-- Filters -->
    <div class="flex flex-col md:flex-row items-stretch md:items-center gap-3 mb-6">
      <div class="flex-1 relative">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input type="text" id="admin-search" placeholder="Search clients..." value="${adminSearch}" oninput="adminSearch=this.value;renderAdminView()"
          class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white pl-10 pr-4 py-2.5 focus:outline-none focus:border-brand-500 transition-all" />
      </div>
      <div class="flex overflow-x-auto gap-1.5 bg-dark-800/60 rounded-xl p-1 border border-dark-600/30 flex-shrink-0">
        ${[
          {id:'all', label:'All'},
          {id:'active', label:'Active'},
          {id:'paused', label:'Paused'},
        ].map(f => `<button onclick="adminFilter='${f.id}';renderAdminView()" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${adminFilter === f.id ? 'bg-brand-500/20 text-brand-400' : 'text-dark-300 hover:text-white'}">${f.label}</button>`).join('')}
        ${managers.map(m => `<button onclick="adminFilter='manager-${esc(m)}';renderAdminView()" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${adminFilter === 'manager-'+m ? 'bg-brand-500/20 text-brand-400' : 'text-dark-300 hover:text-white'}">${m}</button>`).join('')}
      </div>
    </div>

    <!-- Client Table -->
    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto table-scroll-hint">
      <table class="w-full text-sm min-w-[480px] md:min-w-0">
        <thead>
          <tr class="border-b border-dark-600/50 text-dark-300">
            <th class="text-left px-3 md:px-5 py-3 font-semibold">Client</th>
            <th class="text-left px-3 md:px-4 py-3 font-semibold mobile-hide">Manager</th>
            <th class="text-left px-3 md:px-4 py-3 font-semibold mobile-hide">Pod</th>
            <th class="text-center px-3 md:px-4 py-3 font-semibold mobile-hide">Cycles</th>
            <th class="text-center px-3 md:px-4 py-3 font-semibold">Status</th>
            <th class="text-center px-3 md:px-4 py-3 font-semibold">Greg</th>
            <th class="text-right px-3 md:px-5 py-3 font-semibold mobile-hide">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${accts.map((a, idx) => {
            const latestCycle = a.cycles.length ? a.cycles[a.cycles.length - 1] : null;
            const effectiveGregMode = getGregMode(a.name, a.manager);
            const hasOverride = !!gregConfig.accountModes[a.name];
            const isActive = hasActiveCycle(a) && !a.isPaused;
            const isEditing = adminEditingAccount === a.name;
            return `
          <tr class="border-b border-dark-600/20 hover:bg-dark-700/30 transition-all ${idx % 2 === 0 ? '' : 'bg-dark-800/20'}">
            <td class="px-5 py-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${isActive ? 'from-green-500/20 to-green-600/20 border-green-500/20' : 'from-dark-500/20 to-dark-600/20 border-dark-500/20'} border flex items-center justify-center text-[10px] font-bold ${isActive ? 'text-green-400' : 'text-dark-400'}">${a.name.charAt(0)}</div>
                <div>
                  <button onclick="navigate('account',{name:'${esc(a.name)}',adAccountId:'${esc(a.adAccountId||'')}'})" class="font-semibold text-white hover:text-brand-400 transition-colors text-left">${a.name}</button>
                  <div class="text-[10px] text-dark-400 mt-0.5">${a.section || '—'} ${a.adAccountId ? '· act_' + a.adAccountId.slice(0,6) + '...' : ''}</div>
                </div>
              </div>
            </td>
            <td class="px-3 md:px-4 py-3 mobile-hide">
              ${isEditing ? `
                <select id="edit-mgr-${idx}" class="bg-dark-700 border border-dark-500 rounded-lg text-xs px-2 py-1 text-white">
                  ${managers.map(m => `<option value="${m}" ${m === a.manager ? 'selected':''}>${m}</option>`).join('')}
                </select>
              ` : `<span class="text-dark-200">${a.manager}</span>`}
            </td>
            <td class="px-3 md:px-4 py-3 text-dark-300 text-xs mobile-hide">${a.pod ? a.pod.replace(' - RoofIgnite','') : '—'}</td>
            <td class="px-3 md:px-4 py-3 text-center mobile-hide">
              <button onclick="adminEditingCycle={account:'${esc(a.name)}',cycleIndex:${a.cycles.length-1}};renderAdminView()" class="text-brand-400 hover:text-brand-300 font-medium text-xs">${a.cycles.length} cycle${a.cycles.length !== 1 ? 's' : ''}</button>
            </td>
            <td class="px-3 md:px-4 py-3 text-center">
              <button onclick="toggleAccountStatus('${esc(a.name)}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${isActive ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-dark-600/40 text-dark-400 hover:bg-dark-500/40'}">
                <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-dark-500'}"></span>
                ${isActive ? 'Active' : a.isPaused ? 'Paused' : 'Inactive'}
              </button>
            </td>
            <td class="px-3 md:px-4 py-3 text-center">
              <div class="space-y-1" title="${hasOverride ? 'Account override' : 'Using manager default'}">
                <div class="flex items-center gap-1 justify-center">
                  <span class="text-[8px] text-dark-500 w-6 text-right">CPC</span>
                  <div class="inline-flex rounded-md overflow-hidden border ${hasOverride ? 'border-brand-500/40' : 'border-dark-600/30'}">
                    ${['OFF','SOFT','HARD'].map(m => `<button onclick="setAccountGregMode('${esc(a.name)}','${m}','cpc')" class="px-1.5 py-0.5 text-[9px] font-bold transition-all ${effectiveGregMode.cpc === m
                      ? m === 'HARD' ? 'bg-green-500/30 text-green-300' : m === 'SOFT' ? 'bg-yellow-500/30 text-yellow-300' : 'bg-dark-600/60 text-dark-400'
                      : 'text-dark-500 hover:text-dark-200 hover:bg-dark-700/40'}">${m}</button>`).join('')}
                  </div>
                </div>
                <div class="flex items-center gap-1 justify-center">
                  <span class="text-[8px] text-dark-500 w-6 text-right">CPL</span>
                  <div class="inline-flex rounded-md overflow-hidden border ${hasOverride ? 'border-brand-500/40' : 'border-dark-600/30'}">
                    ${['OFF','SOFT','HARD'].map(m => `<button onclick="setAccountGregMode('${esc(a.name)}','${m}','cpl')" class="px-1.5 py-0.5 text-[9px] font-bold transition-all ${effectiveGregMode.cpl === m
                      ? m === 'HARD' ? 'bg-green-500/30 text-green-300' : m === 'SOFT' ? 'bg-yellow-500/30 text-yellow-300' : 'bg-dark-600/60 text-dark-400'
                      : 'text-dark-500 hover:text-dark-200 hover:bg-dark-700/40'}">${m}</button>`).join('')}
                  </div>
                </div>
              </div>
              ${hasOverride ? '<div class="text-[8px] text-brand-400 mt-0.5">override</div>' : ''}
            </td>
            <td class="px-3 md:px-5 py-3 text-right mobile-hide">
              ${isEditing ? `
                <button onclick="saveAccountEdit('${esc(a.name)}', ${idx})" class="text-green-400 hover:text-green-300 text-xs font-medium mr-2">Save</button>
                <button onclick="adminEditingAccount=null;renderAdminView()" class="text-dark-400 hover:text-dark-200 text-xs">Cancel</button>
              ` : `
                <button onclick="adminEditingAccount='${esc(a.name)}';renderAdminView()" class="text-dark-400 hover:text-brand-400 transition-colors p-1" title="Edit">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
              `}
            </td>
          </tr>`;
          }).join('')}
          ${accts.length === 0 ? `<tr><td colspan="7" class="text-center py-10 text-dark-400">No clients match your filter</td></tr>` : ''}
        </tbody>
      </table>
      </div>
    </div>

    <!-- Cycle Editor Modal -->
    ${adminEditingCycle ? renderCycleEditor() : ''}
    ` : ''}
  `;

  // Restore focus to search input
  const searchEl = document.getElementById('admin-search');
  if (searchEl && adminSearch) { searchEl.focus(); searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length); }
}

// ═══════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════
function renderSettingsTab(managers) {
  const hasGAS = !!APPS_SCRIPT_URL;
  const cfg = slackConfigCache || { userIds: {}, globalConfig: {}, billingAdmin: '', notifyToggles: {} };
  const userIds = cfg.userIds || {};
  const gc = cfg.globalConfig || {};
  const toggles = cfg.notifyToggles || {};
  const savedBillingAdmin = localStorage.getItem('roofignite_billing_admin') || cfg.billingAdmin || '';

  const TOGGLE_TYPES = [
    { key: 'audit',        label: 'Audit' },
    { key: 'pace',         label: 'Pace' },
    { key: 'greg',         label: 'Greg' },
    { key: 'cyclewarnings', label: 'Cycle Warn' },
    { key: 'billingauto',  label: 'Billing Auto' },
  ];

  function toggleBtn(manager, type, isOn) {
    return '<button onclick="toggleSlackNotify(\'' + manager + '\',\'' + type + '\',' + (!isOn) + ')" class="relative w-11 h-6 rounded-full transition-colors duration-200 ' + (isOn ? 'bg-green-500' : 'bg-dark-600') + '" title="' + (isOn ? 'Enabled' : 'Disabled') + '"><span class="absolute top-0.5 ' + (isOn ? 'left-[22px]' : 'left-0.5') + ' w-5 h-5 rounded-full bg-white shadow transition-all duration-200"></span></button>';
  }

  return `
    <!-- Slack Connection -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-600/20 border border-purple-500/20 flex items-center justify-center text-sm">💬</span>
        <div>
          <h3 class="text-base font-bold text-white">Slack Connection</h3>
          <p class="text-dark-400 text-xs mt-0.5">Bot token + channel IDs for posting reports to #b2c-reports and #b2b-reports</p>
        </div>
      </div>

      <div class="space-y-3 mt-4">
        <!-- Bot Token -->
        <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 flex items-center gap-3">
          <span class="text-sm font-medium text-white min-w-[100px]">Bot Token</span>
          <div class="flex-1 relative">
            <input id="slack-bot-token" type="password" placeholder="xoxb-..." value="${gc.hasBotToken ? '••••••••••••••••••••' : ''}"
              onfocus="if(this.value.startsWith('••'))this.value=''"
              class="w-full bg-dark-900/80 border border-dark-600/50 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-brand-500 font-mono pr-8" />
          </div>
          <button onclick="saveSlackGlobalConfig()" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30 transition-all">Save</button>
          <span class="text-[10px] font-medium ${gc.hasBotToken ? 'text-green-400' : 'text-dark-500'} min-w-[80px] text-right">${gc.hasBotToken ? '✅ Set' : '⚪ Not set'}</span>
        </div>
        <!-- Channel IDs -->
        <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 flex items-center gap-3">
          <span class="text-sm font-medium text-white min-w-[100px]">B2C Channel</span>
          <input id="slack-channel-b2c" type="text" placeholder="C0XXXXXXX" value="${gc.channelB2C || 'C0AP0HTB951'}"
            class="flex-1 bg-dark-900/80 border border-dark-600/50 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-brand-500 font-mono" />
        </div>
        <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 flex items-center gap-3">
          <span class="text-sm font-medium text-white min-w-[100px]">B2B Channel</span>
          <input id="slack-channel-b2b" type="text" placeholder="C0XXXXXXX" value="${gc.channelB2B || 'C0AP6VAV18S'}"
            class="flex-1 bg-dark-900/80 border border-dark-600/50 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-brand-500 font-mono" />
        </div>
      </div>

      <div class="flex items-center justify-between mt-4">
        <button onclick="testSlackWebhooks()" class="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-dark-700/60 text-dark-200 border border-dark-600/50 hover:bg-dark-600/60 transition-all">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          Send Test to Both Channels
        </button>
        <p class="text-[10px] text-dark-500 max-w-xs text-right">Sends a test message to both #b2c-reports and #b2b-reports</p>
      </div>
    </div>

    <!-- Slack User IDs -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-blue-500/20 flex items-center justify-center text-sm">👤</span>
        <div>
          <h3 class="text-base font-bold text-white">Slack User IDs</h3>
          <p class="text-dark-400 text-xs mt-0.5">Used to @mention managers in channel messages. Find via Slack profile > three dots > Copy member ID</p>
        </div>
      </div>
      <div class="space-y-3 mt-4">
        ${managers.map(m => {
          const isConfigured = userIds[m];
          return `
          <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 flex items-center gap-3">
            <div class="flex items-center gap-2 min-w-[100px]">
              <span class="w-2 h-2 rounded-full ${isConfigured ? 'bg-green-400' : 'bg-dark-500'}"></span>
              <span class="text-sm font-medium text-white">${m}</span>
            </div>
            <input id="slack-uid-${m.replace(/\s/g,'_')}" type="text" placeholder="U0XXXXXXX" value="${isConfigured ? '••••••••••' : ''}"
              onfocus="if(this.value.startsWith('••'))this.value=''"
              class="flex-1 bg-dark-900/80 border border-dark-600/50 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-brand-500 font-mono" />
            <button onclick="saveSlackUserId('${m}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-brand-500/20 text-brand-400 border border-brand-500/30 hover:bg-brand-500/30 transition-all">Save</button>
            <span class="text-[10px] font-medium ${isConfigured ? 'text-green-400' : 'text-dark-500'} min-w-[80px] text-right">${isConfigured ? '✅ Set' : '⚪ Not set'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Billing Admin -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-600/20 border border-green-500/20 flex items-center justify-center text-sm">💰</span>
        <div>
          <h3 class="text-base font-bold text-white">Billing Admin</h3>
          <p class="text-dark-400 text-xs mt-0.5">Receives <span class="text-yellow-400 font-medium">Good to Bill</span> and <span class="text-orange-400 font-medium">Try Again</span> notifications. Billing notifications are always on.</p>
        </div>
      </div>
      <select id="billing-admin-select" onchange="saveBillingAdmin(this.value)" class="bg-dark-900/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2 focus:outline-none focus:border-brand-500 min-w-[160px] mt-2">
        <option value="" ${!savedBillingAdmin ? 'selected' : ''}>— Select —</option>
        ${managers.map(m => `<option value="${m}" ${savedBillingAdmin === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>

    <!-- Notification Toggles -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/20 flex items-center justify-center text-sm">🔔</span>
        <div>
          <h3 class="text-base font-bold text-white">Notification Toggles</h3>
          <p class="text-dark-400 text-xs mt-0.5">Enable or disable individual report types per manager. Billing (Command Centre) notifications are always on.</p>
        </div>
      </div>

      <div class="space-y-3 mt-4">
        <div class="grid grid-cols-[1fr_${TOGGLE_TYPES.map(() => '75px').join('_')}] gap-2 px-3">
          <span class="text-[10px] font-semibold text-dark-300 uppercase tracking-wider">Manager</span>
          ${TOGGLE_TYPES.map(t => `<span class="text-[10px] font-semibold text-dark-300 uppercase tracking-wider text-center">${t.label}</span>`).join('')}
        </div>
        ${managers.map(m => {
          return `
          <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 grid grid-cols-[1fr_${TOGGLE_TYPES.map(() => '75px').join('_')}] gap-2 items-center">
            <span class="text-sm font-medium text-white">${m}</span>
            ${TOGGLE_TYPES.map(t => {
              const isOn = (toggles[t.key] || {})[m] !== false;
              return '<div class="flex justify-center">' + toggleBtn(m, t.key, isOn) + '</div>';
            }).join('')}
          </div>`;
        }).join('')}
      </div>

      <p class="text-[10px] text-dark-500 mt-3">When disabled, the script will skip Slack messages for that manager. Default is <span class="text-green-400">enabled</span> for all.</p>
    </div>

    <!-- Manual Run -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center text-sm">▶️</span>
        <div>
          <h3 class="text-base font-bold text-white">Run Reports Manually</h3>
          <p class="text-dark-400 text-xs mt-0.5">Trigger a specific report for a single manager. Only that manager's report will be generated and sent.</p>
        </div>
      </div>

      <div class="space-y-3 mt-4">
        ${managers.map(m => `
          <div class="bg-dark-800/60 rounded-xl p-3.5 border border-dark-600/30 flex items-center gap-3">
            <span class="text-sm font-medium text-white min-w-[100px]">${m}</span>
            <div class="flex gap-2 flex-wrap">
              <button onclick="runScript('audit','${m}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all">Run Audit</button>
              <button onclick="runScript('pace','${m}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 transition-all">Run Pace</button>
              <button onclick="runScript('greg','${m}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/30 hover:bg-orange-500/30 transition-all">Run Greg</button>
              <button onclick="runScript('cycleWarnings','${m}')" class="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-all">Run Cycle Warnings</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Apps Script Connection -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-4">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-600/20 border border-green-500/20 flex items-center justify-center text-sm">📡</span>
        <div>
          <h3 class="text-base font-bold text-white">Apps Script Connection</h3>
          <p class="text-dark-400 text-xs mt-0.5">Connect to Google Apps Script for sheet write-back and Slack notifications</p>
        </div>
      </div>

      <div class="flex gap-3 items-center mb-4">
        <input id="gas-url-settings" type="text" placeholder="Paste Apps Script web app URL..." value="${APPS_SCRIPT_URL || ''}"
          class="flex-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500 font-mono text-xs" />
        <button onclick="const u=document.getElementById('gas-url-settings').value.trim();if(u){APPS_SCRIPT_URL=u;localStorage.setItem('roofignite_gas_url',u);showToast('Apps Script connected!','success');loadSlackConfig();renderAdminView();}else{showToast('Please paste a URL','error');}" class="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-brand-500 to-brand-600 text-white hover:from-brand-600 hover:to-brand-700 transition-all shadow-lg shadow-brand-500/20">Connect</button>
        <span class="text-xs font-medium ${hasGAS ? 'text-green-400' : 'text-dark-500'}">${hasGAS ? '✅ Connected' : '⚪ Not connected'}</span>
      </div>

      ${hasGAS ? `<div class="flex items-center gap-2 mb-4">
        <button onclick="APPS_SCRIPT_URL='';localStorage.removeItem('roofignite_gas_url');showToast('Disconnected','success');renderAdminView()" class="text-[10px] text-red-400 hover:text-red-300 font-medium underline">Disconnect</button>
      </div>` : ''}
    </div>
  `;
}

// ═══ Slack Settings Helpers ═══

async function saveSlackUserId(name) {
  const inputId = 'slack-uid-' + name.replace(/\s/g, '_');
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const uid = inp.value.trim();
  if (uid.startsWith('••')) { showToast('Click the field and enter a Slack User ID first', 'error'); return; }
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }

  const result = await writeToSheet('saveSlackUserId', { person: name, slackUserId: uid });
  if (result.ok) {
    showToast(`Slack User ID ${uid ? 'saved' : 'removed'} for ${name}`, 'success');
    slackConfigCache = null;
    await loadSlackConfig();
    renderAdminView();
  } else {
    showToast('Failed to save Slack User ID', 'error');
  }
}

async function saveSlackGlobalConfig() {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  const tokenInp = document.getElementById('slack-bot-token');
  const b2cInp = document.getElementById('slack-channel-b2c');
  const b2bInp = document.getElementById('slack-channel-b2b');
  const data = {};
  if (tokenInp) {
    const val = tokenInp.value.trim();
    if (!val.startsWith('••')) data.botToken = val;
  }
  if (b2cInp) data.channelB2C = b2cInp.value.trim();
  if (b2bInp) data.channelB2B = b2bInp.value.trim();

  const result = await writeToSheet('saveSlackGlobalConfig', data);
  if (result.ok) {
    showToast('Slack config saved', 'success');
    slackConfigCache = null;
    await loadSlackConfig();
    renderAdminView();
  } else {
    showToast('Failed to save Slack config', 'error');
  }
}

async function loadSlackConfig() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const result = await writeToSheet('getSlackConfig', {});
    if (result.ok) {
      slackConfigCache = result;
      if (result.billingAdmin && !localStorage.getItem('roofignite_billing_admin')) {
        localStorage.setItem('roofignite_billing_admin', result.billingAdmin);
      }
    }
  } catch (e) {
    console.error('Failed to load Slack config:', e);
  }
}

async function testSlackWebhooks() {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  showToast('Sending test to both channels...', 'success');
  const result = await writeToSheet('testSlackWebhook', {});
  if (result.ok && result.count > 0) {
    showToast(`Test sent to ${result.count} channel(s)`, 'success');
  } else {
    const errMsg = result.error || 'No channels received the test — check bot token, channel IDs, and that the bot is added to both channels.';
    showToast(errMsg, 'error', 12000);
  }
}

async function saveBillingAdmin(name) {
  localStorage.setItem('roofignite_billing_admin', name);
  if (APPS_SCRIPT_URL) {
    await writeToSheet('saveBillingAdmin', { name: name });
  }
  showToast(`Billing admin set to ${name || 'none'}`, 'success');
}

async function toggleSlackNotify(manager, type, enabled) {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  const result = await writeToSheet('setSlackNotifyToggle', { manager, type, enabled });
  if (result.ok) {
    // Update local cache immediately for instant UI feedback
    if (!slackConfigCache) slackConfigCache = { userIds: {}, globalConfig: {}, billingAdmin: '', notifyToggles: {} };
    if (!slackConfigCache.notifyToggles) slackConfigCache.notifyToggles = {};
    if (!slackConfigCache.notifyToggles[type]) slackConfigCache.notifyToggles[type] = {};
    if (enabled) { delete slackConfigCache.notifyToggles[type][manager]; }
    else { slackConfigCache.notifyToggles[type][manager] = false; }
    const labels = { audit: 'Audit Reports', pace: 'Pace Reports', greg: 'Greg Reports', cyclewarnings: 'Cycle Warnings', billingauto: 'Billing Auto' };
    showToast(`${labels[type] || type} ${enabled ? 'enabled' : 'disabled'} for ${manager}`, 'success');
    renderAdminView();
  } else {
    showToast('Failed to update toggle', 'error');
  }
}

async function runScript(scriptName, manager) {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  showToast(`Running ${scriptName} for ${manager}...`, 'success');
  const result = await writeToSheet('runScript', { script: scriptName, manager: manager });
  if (result.ok) {
    showToast(`${scriptName} report sent for ${manager}`, 'success');
  } else {
    showToast(`Failed to run ${scriptName}: ${result.error || 'unknown error'}`, 'error');
  }
}

function renderNewManagerForm() {
  return `
    <div class="glass rounded-2xl p-6 mb-6 border border-blue-500/30">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          Add New Manager
        </h2>
        <button onclick="adminShowNewManager=false;renderAdminView()" class="text-dark-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Manager Name *</label>
          <input id="new-manager-name" type="text" placeholder="e.g. Sarah" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Pod *</label>
          <select id="new-manager-pod" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-blue-500">
            ${Object.keys(SHEETS).map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="text-[11px] text-dark-400 mb-4">This will create a blue header row in the selected pod sheet and set Greg to SOFT mode by default. You can add accounts under this manager afterward.</p>
      <div class="flex justify-end gap-3">
        <button onclick="adminShowNewManager=false;renderAdminView()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="createNewManager()" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/20 transition-all">Create Manager</button>
      </div>
    </div>
  `;
}

async function createNewManager() {
  const name = document.getElementById('new-manager-name')?.value?.trim();
  const pod = document.getElementById('new-manager-pod')?.value;

  if (!name) { showToast('Please enter a manager name', 'error'); return; }

  const managers = getManagers();
  if (managers.find(m => m.toLowerCase() === name.toLowerCase())) {
    showToast('Manager already exists', 'error'); return;
  }

  // Update local state
  gregConfig.managerModes[name] = { cpc: 'SOFT', cpl: 'SOFT' };
  adminShowNewManager = false;
  renderSidebarManagers();  // update sidebar with new manager
  renderAdminView();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('addManager', { name, pod });
    if (result.ok) {
      showToast(`Manager "${name}" created in ${pod} ✓ Saved to Sheet`, 'success');
    } else {
      showToast(`⚠️ "${name}" added locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`Manager "${name}" added locally (connect Apps Script to save)`, 'warning');
  }
}

function confirmDeleteManager(mgrName, acctCount) {
  // SAFETY: Can't delete the last manager
  const managers = getManagers();
  if (managers.length <= 1) {
    showToast('Cannot remove the last manager — at least one must exist', 'error');
    return;
  }

  const otherManagers = managers.filter(m => m !== mgrName);
  const activeAccts = allAccounts.filter(a => a.manager === mgrName && hasActiveCycle(a));
  const activeCount = activeAccts.length;
  const inactiveCount = acctCount - activeCount;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-md w-full border border-red-500/30 modal-inner" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </div>
        <h3 class="text-white font-bold text-lg">Remove Manager</h3>
      </div>

      ${acctCount > 0 ? `
        <div class="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-4">
          <p class="text-blue-300 text-xs font-semibold mb-1">📋 Reassign ${acctCount} account${acctCount > 1 ? 's' : ''} to:</p>
          <select id="delete-mgr-reassign" class="w-full mt-2 bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 focus:outline-none focus:border-blue-500">
            ${otherManagers.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
          ${activeCount > 0 ? `<p class="text-red-300 text-[11px] mt-2">⚠️ ${activeCount} of these are ACTIVE</p>` : ''}
          ${inactiveCount > 0 ? `<p class="text-yellow-300 text-[11px] mt-1">${inactiveCount} inactive/paused</p>` : ''}
        </div>
      ` : `
        <p class="text-dark-300 text-sm mb-4">${mgrName} has no accounts assigned.</p>
      `}

      <p class="text-dark-200 text-sm mb-3">Type <span class="text-red-400 font-bold">${mgrName}</span> to confirm:</p>
      <input id="delete-mgr-confirm-input" type="text" placeholder="Type manager name..." class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-red-500 mb-4" autocomplete="off" spellcheck="false" />

      <div class="flex justify-end gap-3">
        <button onclick="this.closest('.fixed').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button id="delete-mgr-confirm-btn" onclick="executeDeleteManager('${esc(mgrName)}')" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/20 transition-all opacity-40 cursor-not-allowed" disabled>Remove & Reassign</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Enable button ONLY when typed name matches exactly
  setTimeout(() => {
    const input = document.getElementById('delete-mgr-confirm-input');
    const btn = document.getElementById('delete-mgr-confirm-btn');
    if (input && btn) {
      input.focus();
      input.addEventListener('input', () => {
        const matches = input.value.trim().toLowerCase() === mgrName.toLowerCase();
        btn.disabled = !matches;
        btn.classList.toggle('opacity-40', !matches);
        btn.classList.toggle('cursor-not-allowed', !matches);
      });
    }
  }, 50);
}

function executeDeleteManager(mgrName) {
  // Double-check typed confirmation
  const input = document.getElementById('delete-mgr-confirm-input');
  if (!input || input.value.trim().toLowerCase() !== mgrName.toLowerCase()) {
    showToast('Type the manager name exactly to confirm', 'error');
    return;
  }

  // Get reassign target
  const reassignSelect = document.getElementById('delete-mgr-reassign');
  const reassignTo = reassignSelect ? reassignSelect.value : null;

  // Close modal
  const modal = document.getElementById('delete-mgr-confirm-btn')?.closest('.fixed');
  if (modal) modal.remove();

  // Execute the delete with reassignment
  deleteManager(mgrName, reassignTo);
}

async function deleteManager(mgrName, reassignTo) {
  // SAFETY: Last-check — don't delete the last manager
  const managers = getManagers();
  if (managers.length <= 1) {
    showToast('Cannot remove the last manager', 'error');
    return;
  }

  // Reassign accounts locally
  if (reassignTo) {
    allAccounts.filter(a => a.manager === mgrName).forEach(a => {
      a.manager = reassignTo;
    });
  }

  // Remove from gregConfig
  delete gregConfig.managerModes[mgrName];
  allAccounts.filter(a => a.manager === reassignTo).forEach(a => {
    // Clean up any account-level greg overrides that belonged to deleted manager's accounts
    // (they're now under the new manager so keep them unless you want a reset)
  });

  // Update sidebar and admin view
  renderSidebarManagers();
  renderAdminView();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('deleteManager', { name: mgrName, reassignTo: reassignTo || '' }, { silent: true });
    if (result.ok) {
      const msg = reassignTo ? `"${mgrName}" removed — ${allAccounts.filter(a => a.manager === reassignTo).length > 0 ? 'accounts reassigned to ' + reassignTo : 'done'} ✓` : `Manager "${mgrName}" removed ✓`;
      showToast(msg, 'success');
    } else {
      const errMsg = result.error || '';
      console.error('[DeleteManager] GAS error:', errMsg);
      if (errMsg.includes('Unknown action')) {
        showToast(`"${mgrName}" removed locally. To sync: redeploy Apps Script (Manage Deployments → Edit → New Version → Deploy)`, 'warning');
      } else {
        showToast(`"${mgrName}" removed locally, but Sheet sync failed: ${errMsg || 'check console'}`, 'error');
      }
    }
  } else {
    showToast(`Manager "${mgrName}" removed locally (connect Apps Script to sync)`, 'warning');
  }
}

function renderNewClientForm(managers) {
  return `
    <div class="glass rounded-2xl p-6 mb-6 border border-brand-500/30">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <svg class="w-5 h-5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
          Add New Client
        </h2>
        <button onclick="adminShowNewClient=false;renderAdminView()" class="text-dark-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Client Name *</label>
          <input id="new-client-name" type="text" placeholder="e.g. Apex Roofing" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
          <div class="text-[9px] text-red-400/80 mt-1">Must match the logbook name EXACTLY or reporting will break</div>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Account Manager *</label>
          <select id="new-client-manager" onchange="updateNewClientPod()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500">
            ${managers.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Pod *</label>
          <select id="new-client-pod" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500">
            ${Object.keys(SHEETS).map(p => {
              const label = p.replace(/ - RoofIgnite/i, '');
              const autoSelected = (managerPodMap[managers[0]] === p) ? 'selected' : '';
              return `<option value="${p}" ${autoSelected}>${label}</option>`;
            }).join('')}
          </select>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Meta Ad Account ID</label>
          <input id="new-client-adid" type="text" placeholder="e.g. 1234567890" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Booked Goal</label>
          <input id="new-client-booked-goal" type="number" placeholder="6" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Daily Budget ($)</label>
          <input id="new-client-daily" type="number" placeholder="50" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
          <div class="text-[9px] text-dark-500 mt-1">Monthly budget auto-calculated (daily × 28)</div>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Cycle Start Date</label>
          <input id="new-client-start-date" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
          <div class="text-[9px] text-dark-500 mt-1">Cycle ends 28 days after start</div>
        </div>
      </div>
      <div class="flex justify-end gap-3">
        <button onclick="adminShowNewClient=false;renderAdminView()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="createNewClient()" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 shadow-lg shadow-brand-500/20 transition-all">Create Client</button>
      </div>
    </div>
  `;
}

function updateNewClientPod() {
  const mgr = document.getElementById('new-client-manager')?.value;
  const podSelect = document.getElementById('new-client-pod');
  if (podSelect && mgr && mgr !== '_new') {
    const autoPod = managerPodMap[mgr];
    if (autoPod && podSelect.querySelector(`option[value="${autoPod}"]`)) {
      podSelect.value = autoPod;
    }
  }
}

function renderCycleEditor() {
  const acct = allAccounts.find(a => a.name === adminEditingCycle.account);
  if (!acct) return '';
  const cycles = acct.cycles;

  return `
    <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onclick="if(event.target===this){adminEditingCycle=null;renderAdminView()}">
      <div class="glass rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden modal-inner" onclick="event.stopPropagation()">
        <div class="p-5 border-b border-dark-600/50 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-white">${acct.name}</h2>
            <p class="text-dark-300 text-xs mt-0.5">${cycles.length} cycles · Manager: ${acct.manager}</p>
          </div>
          <div class="flex items-center gap-3">
            <button onclick="addNewCycle('${esc(acct.name)}')" class="text-brand-400 hover:text-brand-300 text-xs font-semibold flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
              Add Cycle
            </button>
            <button onclick="adminEditingCycle=null;renderAdminView()" class="text-dark-400 hover:text-white transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="overflow-y-auto max-h-[calc(80vh-80px)] p-5">
          <div class="overflow-x-auto table-scroll-hint">
            <table class="w-full text-xs min-w-[480px] md:min-w-[1100px]">
              <thead>
                <tr class="text-dark-300 border-b border-dark-600/40">
                  <th class="text-left px-3 py-2 font-semibold">Cycle</th>
                  <th class="text-left px-3 py-2 font-semibold">Start</th>
                  <th class="text-left px-3 py-2 font-semibold">End</th>
                  <th class="text-center px-3 py-2 font-semibold mobile-hide">Days</th>
                  <th class="text-right px-3 py-2 font-semibold mobile-hide">Bk Goal</th>
                  <th class="text-right px-3 py-2 font-semibold mobile-hide">Greg $</th>
                  <th class="text-right px-3 py-2 font-semibold mobile-hide">CPA $</th>
                  <th class="text-right px-3 py-2 font-semibold mobile-hide">Daily $</th>
                  <th class="text-right px-3 py-2 font-semibold mobile-hide">Monthly $</th>
                  <th class="text-right px-3 py-2 font-semibold">Leads</th>
                  <th class="text-right px-3 py-2 font-semibold">Booked</th>
                  <th class="text-right px-3 py-2 font-semibold">Spent</th>
                  <th class="text-center px-3 py-2 font-semibold mobile-hide">GTB</th>
                  <th class="text-center px-3 py-2 font-semibold mobile-hide">Billed</th>
                  <th class="text-center px-3 py-2 font-semibold">Edit</th>
                </tr>
              </thead>
              <tbody>
                ${cycles.map((c, ci) => {
                  const isEditingThis = adminEditingCycle.editIndex === ci;
                  return `
                <tr class="border-b border-dark-600/20 hover:bg-dark-700/30 ${ci === cycles.length - 1 ? 'bg-brand-500/5' : ''}">
                  <td class="px-3 py-2 font-semibold text-white">${c.cycle}${ci === cycles.length - 1 ? ' <span class="text-brand-400 text-[9px]">CURRENT</span>' : ''}</td>
                  <td class="px-3 py-2 text-dark-200">${isEditingThis ? '<input id="ce-start" type="date" value="'+(c.cycleStartDate||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-28"/>' : (c.cycleStartDate || '—')}</td>
                  <td class="px-3 py-2 text-dark-200">${isEditingThis ? '<input id="ce-end" type="date" value="'+(c.cycleEndDate||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-28"/>' : (c.cycleEndDate || '—')}</td>
                  <td class="px-3 py-2 text-center text-dark-300 mobile-hide">${c.cycleStartDate && c.cycleEndDate ? Math.round((parseLocalDate(c.cycleEndDate) - parseLocalDate(c.cycleStartDate)) / 86400000) : '—'}</td>
                  <td class="px-3 py-2 text-right text-dark-200 mobile-hide">${isEditingThis ? '<input id="ce-bgoal" type="number" value="'+(c.bookedGoal||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-16 text-right"/>' : (c.bookedGoal ?? '—')}</td>
                  <td class="px-3 py-2 text-right text-dark-200 mobile-hide">${isEditingThis ? '<input id="ce-ggoal" type="number" value="'+(c.gregGoal||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-16 text-right"/>' : (c.gregGoal ?? '—')}</td>
                  <td class="px-3 py-2 text-right text-dark-200 mobile-hide">${isEditingThis ? '<input id="ce-cpa" type="number" value="'+(c.cpaGoal||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-16 text-right"/>' : (c.cpaGoal ? '$'+c.cpaGoal : '—')}</td>
                  <td class="px-3 py-2 text-right text-dark-200 mobile-hide">${isEditingThis ? '<input id="ce-daily" type="number" value="'+(c.dailyBudget||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-16 text-right"/>' : (c.dailyBudget ? '$'+c.dailyBudget : '—')}</td>
                  <td class="px-3 py-2 text-right text-dark-200 mobile-hide">${isEditingThis ? '<input id="ce-monthly" type="number" value="'+(c.monthlyBudget||'')+'" class="bg-dark-700 border border-dark-500 rounded px-1.5 py-0.5 text-white text-[11px] w-20 text-right"/>' : (c.monthlyBudget ? '$'+Number(c.monthlyBudget).toLocaleString() : '—')}</td>
                  <td class="px-3 py-2 text-right ${c.totalLeads > 0 ? 'text-white font-medium' : 'text-dark-400'}">${c.totalLeads ?? '—'}</td>
                  <td class="px-3 py-2 text-right ${c.bookedAppts > 0 ? 'text-white font-medium' : 'text-dark-400'}">${c.bookedAppts ?? '—'}</td>
                  <td class="px-3 py-2 text-right text-dark-200">${c.amountSpent ? '$'+Number(c.amountSpent).toLocaleString() : '—'}</td>
                  <td class="px-3 py-2 text-center mobile-hide"><span class="text-[10px] ${(c.goodToBill||'').toLowerCase()==='yes' ? 'text-emerald-400 font-semibold' : 'text-dark-500'}">${(c.goodToBill||'').toLowerCase()==='yes' ? '✓' : '—'}</span></td>
                  <td class="px-3 py-2 text-center mobile-hide"><span class="text-[10px] ${(c.billed||'').toLowerCase()==='yes' ? 'text-blue-400 font-semibold' : 'text-dark-500'}">${(c.billed||'').toLowerCase()==='yes' ? '✓' : '—'}</span></td>
                  <td class="px-3 py-2 text-center">
                    ${isEditingThis ? `
                      <button onclick="saveCycleEdit('${esc(acct.name)}',${ci})" class="text-green-400 hover:text-green-300 text-[10px] font-semibold mr-1">Save</button>
                      <button onclick="adminEditingCycle.editIndex=null;renderAdminView()" class="text-dark-400 hover:text-white text-[10px]">✕</button>
                    ` : `
                      <button onclick="adminEditingCycle.editIndex=${ci};renderAdminView()" class="text-dark-400 hover:text-brand-400 transition-colors">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                      </button>
                    `}
                  </td>
                </tr>`;
                }).join('')}
                ${cycles.length === 0 ? '<tr><td colspan="15" class="text-center py-6 text-dark-400">No cycles yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ═══ CRUD Actions ═══

async function createNewClient() {
  const name = document.getElementById('new-client-name')?.value?.trim();
  const manager = document.getElementById('new-client-manager')?.value;
  const adId = document.getElementById('new-client-adid')?.value?.trim()?.replace(/^act_/i, '');
  const bookedGoal = parseFloat(document.getElementById('new-client-booked-goal')?.value) || null;
  const dailyBudget = parseFloat(document.getElementById('new-client-daily')?.value) || null;
  const cycleStartInput = document.getElementById('new-client-start-date')?.value;

  if (!name) { showToast('Please enter a client name', 'error'); return; }
  if (allAccounts.find(a => a.name.toLowerCase() === name.toLowerCase())) { showToast('Client already exists', 'error'); return; }

  const mgr = manager;

  const pod = document.getElementById('new-client-pod')?.value || Object.keys(SHEETS)[0];

  // Cycle dates: use selected start date, end = start + 28 days
  const startDate = cycleStartInput || new Date().toISOString().split('T')[0];
  const endDate = new Date(new Date(startDate).getTime() + 28 * 86400000).toISOString().split('T')[0];

  const cycle1 = {
    account: name, adAccountId: adId || '', pod, manager: mgr,
    cycle: 'Cycle 1', cycleStartDate: startDate, cycleEndDate: endDate,
    bookedGoal, gregGoal: bookedGoal, cpaGoal: null, dailyBudget, monthlyBudget: dailyBudget ? dailyBudget * 28 : null,
    totalLeads: null, osaPct: null, bookedAppts: null, estBookedAppts: null,
    cpa: null, amountSpent: null, linkCTR: null, linkCPC: null,
    cpm: null, frequency: null, surveyPct: null,
    cpcMedian: null, cpcMultiplier: null,
    accountManager: mgr, notes: '', goodToBill: 'No', billed: 'No', billingNotes: ''
  };

  const newAcct = {
    name, manager: mgr, pod, adAccountId: adId || '', section: '',
    isPaused: false, status: 'Q1 Onboarded',
    bookedGoal, gregGoal: bookedGoal, cpaGoal: null, dailyBudget, monthlyBudget: dailyBudget ? dailyBudget * 28 : null,
    cycleStartDate: startDate, cycleEndDate: endDate,
    cycles: [cycle1]
  };

  allAccounts.push(newAcct);
  adminShowNewClient = false;
  renderAdminView();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('createClient', newAcct);
    if (result.ok) {
      showToast(`Created "${name}" under ${mgr} ✓ Saved to Sheet`, 'success');
    } else {
      showToast(`⚠️ "${name}" created locally, but failed to save to Sheet`, 'error');
    }

    // Auto-create Drive folder structure
    try {
      // Check if folder already exists (possible dupe from another client or old data)
      const checkResult = await writeToSheet('checkClientFolder', { clientName: name }, { silent: true });
      if (checkResult.ok && checkResult.exists) {
        // Folder exists — ask user to confirm
        if (confirm(`A folder named "${name}" already exists in Master Creatives. Use the existing folder? Click Cancel to skip folder creation.`)) {
          // Ensure subfolders exist in the existing folder
          await writeToSheet('createClientFolder', { clientName: name }, { silent: true });
          showToast('Drive folders ready ✓', 'success');
        }
      } else {
        // No existing folder — create it
        await writeToSheet('createClientFolder', { clientName: name }, { silent: true });
        showToast('Drive folders created ✓', 'success');
      }
    } catch(e) {
      console.warn('Drive folder creation failed:', e);
    }
  } else {
    showToast(`Created "${name}" under ${mgr} (local only — connect Apps Script to save)`, 'warning');
  }
}

// ═══════════════════════════════════════════════════════════════
//  POD SETTINGS — manage pods (add / delete)
// ═══════════════════════════════════════════════════════════════

function showPodSettingsModal() {
  if (!APPS_SCRIPT_URL) {
    showToast('Connect Apps Script first to manage pods', 'warning');
    return;
  }

  // Determine next pod number from existing pods
  let maxNum = 0;
  Object.keys(SHEETS).forEach(name => {
    const match = name.match(/^Pod\s*(\d+)/i);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
  });
  const suggestedName = `Pod ${maxNum + 1} - RoofIgnite`;

  // Build existing pods list
  const podNames = Object.keys(SHEETS);
  const podListHtml = podNames.map(name => `
    <div class="flex items-center justify-between bg-dark-800/60 rounded-xl px-4 py-3 border border-dark-600/30">
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 rounded-full bg-teal-400"></div>
        <span class="text-white text-sm font-medium">${esc(name)}</span>
      </div>
      <button onclick="confirmDeletePod('${esc(name).replace(/'/g, "\\'")}')" class="text-dark-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10" title="Delete pod">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>
  `).join('');

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  modal.id = 'pod-settings-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-md w-full scale-in" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-bold text-white">Pod Settings</h2>
        <button onclick="document.getElementById('pod-settings-modal').remove()" class="text-dark-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Existing Pods -->
      <div class="mb-6">
        <h3 class="text-sm font-semibold text-dark-300 mb-3">Existing Pods (${podNames.length})</h3>
        <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
          ${podListHtml}
        </div>
      </div>

      <!-- Divider -->
      <div class="border-t border-dark-600/30 mb-5"></div>

      <!-- Add New Pod -->
      <h3 class="text-sm font-semibold text-dark-300 mb-3">Add New Pod</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm text-dark-300 mb-1.5">Pod Name</label>
          <input type="text" id="new-pod-name" value="${suggestedName}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500/50" />
          <p class="text-[11px] text-dark-500 mt-1">This will create a new sheet tab with headers copied from an existing pod.</p>
        </div>

        <div>
          <label class="block text-sm text-dark-300 mb-1.5">Primary Lead Source</label>
          <select id="new-pod-lead-source" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-brand-500/50">
            <option value="ALL_ROOF" selected>ALL_ROOF (Roofing)</option>
            <option value="ALL_CiGN">ALL_CiGN (HVAC / Gutters)</option>
          </select>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <button onclick="document.getElementById('pod-settings-modal').remove()" class="px-4 py-2 rounded-xl text-sm text-dark-400 hover:text-white transition-colors">Close</button>
          <button onclick="createNewPod()" class="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-600 text-white hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg">Create Pod</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function createNewPod() {
  const nameInput = document.getElementById('new-pod-name');
  const sourceSelect = document.getElementById('new-pod-lead-source');
  const podName = nameInput?.value?.trim();
  const leadSource = sourceSelect?.value || 'ALL_ROOF';

  if (!podName) {
    showToast('Pod name cannot be empty', 'error');
    return;
  }

  if (SHEETS[podName]) {
    showToast(`"${podName}" already exists`, 'error');
    return;
  }

  // Close modal
  const modal = document.getElementById('pod-settings-modal');
  if (modal) modal.remove();

  showToast(`Creating "${podName}"...`, 'info');

  const result = await writeToSheet('createPod', { podName, leadSource });

  if (result.ok && result.pod) {
    // Add the new pod to the live config
    SHEETS[result.pod.name] = result.pod.gid;

    // Update lead source mapping if available
    if (CONFIG.POD_LEAD_SOURCES) {
      CONFIG.POD_LEAD_SOURCES[result.pod.name] = {
        primary: result.pod.leadSource,
        fallback: result.pod.fallbackSource
      };
    }

    // Re-render sidebar to show the new pod
    renderSidebarPods();

    // Reload data to include the new (empty) pod
    await loadAllData({ silent: true });

    showToast(`Pod "${result.pod.name}" created successfully`, 'success');
    renderAdminView();
  } else {
    showToast(`Failed to create pod: ${result.error || 'Unknown error'}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  DELETE POD — two-step verification flow
// ═══════════════════════════════════════════════════════════════

function confirmDeletePod(podName) {
  // Safety: can't delete the last pod
  if (Object.keys(SHEETS).length <= 1) {
    showToast('Cannot delete the last pod — at least one must exist', 'error');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4';
  overlay.id = 'delete-pod-confirm';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-sm w-full border border-red-500/30 scale-in" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
        </div>
        <h3 class="text-white font-bold text-lg">Delete Pod</h3>
      </div>

      <p class="text-dark-200 text-sm mb-6">Are you sure you want to delete <span class="text-red-400 font-bold">${esc(podName)}</span>? This will permanently remove the sheet tab and all its data.</p>

      <div class="flex justify-end gap-3">
        <button onclick="document.getElementById('delete-pod-confirm').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="document.getElementById('delete-pod-confirm').remove(); showDeletePodVerification('${esc(podName).replace(/'/g, "\\'")}')" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/20 transition-all">Yes, Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showDeletePodVerification(podName) {
  // Build height options from 5'2" to 6'2"
  const heights = [];
  for (let ft = 5; ft <= 6; ft++) {
    const startIn = (ft === 5) ? 2 : 0;
    const endIn = (ft === 6) ? 2 : 11;
    for (let inc = startIn; inc <= endIn; inc++) {
      heights.push(`${ft}'${inc}"`);
    }
  }
  const optionsHtml = heights.map(h => `<option value="${h.replace(/"/g, '&quot;')}">${h}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4';
  overlay.id = 'delete-pod-verify';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-sm w-full border border-amber-500/30 scale-in" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
        </div>
        <h3 class="text-white font-bold text-lg">Verification</h3>
      </div>

      <p class="text-dark-200 text-sm mb-4">How tall is Mani Asadi?</p>

      <select id="delete-pod-height-answer" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500/50 mb-5">
        <option value="" disabled selected>Select height...</option>
        ${optionsHtml}
      </select>

      <div class="flex justify-end gap-3">
        <button onclick="document.getElementById('delete-pod-verify').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="submitDeletePodVerification('${esc(podName).replace(/'/g, "\\'")}')" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/20 transition-all">Confirm Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function submitDeletePodVerification(podName) {
  const select = document.getElementById('delete-pod-height-answer');
  const answer = select ? select.value : '';

  if (!answer) {
    showToast('Please select an answer', 'error');
    return;
  }

  if (answer !== '5\'2"') {
    showToast('Incorrect answer', 'error');
    return;
  }

  // Correct answer — close verification and execute delete
  const verifyModal = document.getElementById('delete-pod-verify');
  if (verifyModal) verifyModal.remove();

  executeDeletePod(podName);
}

async function executeDeletePod(podName) {
  // Close the pod settings modal too
  const settingsModal = document.getElementById('pod-settings-modal');
  if (settingsModal) settingsModal.remove();

  showToast(`Deleting "${podName}"...`, 'info');

  const result = await writeToSheet('deletePod', { podName });

  if (result.ok) {
    // Remove from live config
    delete SHEETS[podName];
    if (CONFIG.POD_LEAD_SOURCES) {
      delete CONFIG.POD_LEAD_SOURCES[podName];
    }

    // Re-render sidebar
    renderSidebarPods();

    // Reload data
    await loadAllData({ silent: true });

    showToast(`Pod "${podName}" deleted successfully`, 'success');
    renderAdminView();
  } else {
    showToast(`Failed to delete pod: ${result.error || 'Unknown error'}`, 'error');
  }
}

async function saveAccountEdit(name, rowIdx) {
  const acct = allAccounts.find(a => a.name === name);
  if (!acct) return;

  const mgrSelect = document.getElementById('edit-mgr-' + rowIdx);
  if (mgrSelect) {
    const newMgr = mgrSelect.value;
    if (newMgr !== acct.manager) {
      const oldMgr = acct.manager;
      acct.manager = newMgr;
      acct.cycles.forEach(c => c.manager = newMgr);
      adminEditingAccount = null;
      renderAdminView();

      if (APPS_SCRIPT_URL) {
        const result = await writeToSheet('updateManager', { name, manager: newMgr });
        if (result.ok) {
          showToast(`Moved "${name}" from ${oldMgr} to ${newMgr} ✓ Saved`, 'success');
        } else {
          showToast(`⚠️ "${name}" moved locally, but failed to save to Sheet`, 'error');
        }
      } else {
        showToast(`Moved "${name}" from ${oldMgr} to ${newMgr} (local only)`, 'success');
      }
      return;
    }
  }

  adminEditingAccount = null;
  renderAdminView();
}

// ═══════════════════════════════════════════════
// TRANSFER ACCOUNTS BETWEEN MANAGERS / PODS
// ═══════════════════════════════════════════════
let transferSelectedAccounts = new Set();

function openTransferModal() {
  transferSelectedAccounts = new Set();
  const managers = getManagers();
  const podNames = Object.keys(SHEETS);

  const modal = document.createElement('div');
  modal.id = 'transfer-modal';
  modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto modal-inner" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-600/20 flex items-center justify-center border border-indigo-500/20">
            <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
          </div>
          <div>
            <h2 class="text-lg font-bold text-white">Transfer Accounts</h2>
            <p class="text-dark-400 text-xs mt-0.5">Move accounts between managers and pods</p>
          </div>
        </div>
        <button onclick="document.getElementById('transfer-modal').remove()" class="text-dark-400 hover:text-white transition-colors p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Source Manager -->
      <div class="mb-4">
        <label class="block text-sm font-medium text-dark-200 mb-2">From Manager</label>
        <select id="transfer-from-mgr" onchange="renderTransferAccountList()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-indigo-500 transition-colors">
          <option value="">Select source manager...</option>
          ${managers.map(m => {
            const count = allAccounts.filter(a => a.manager === m).length;
            const pod = managerPodMap[m] ? managerPodMap[m].replace(' - RoofIgnite','') : '?';
            return `<option value="${m}">${m} (${count} accounts · ${pod})</option>`;
          }).join('')}
        </select>
      </div>

      <!-- Account List (dynamic) -->
      <div id="transfer-account-list" class="mb-4"></div>

      <!-- Destination Manager -->
      <div class="mb-4">
        <label class="block text-sm font-medium text-dark-200 mb-2">To Manager</label>
        <select id="transfer-to-mgr" onchange="updateTransferPodDisplay()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-indigo-500 transition-colors">
          <option value="">Select destination manager...</option>
          ${managers.map(m => {
            const pod = managerPodMap[m] ? managerPodMap[m].replace(' - RoofIgnite','') : '?';
            return `<option value="${m}">${m} (${pod})</option>`;
          }).join('')}
        </select>
      </div>

      <!-- Destination Pod (auto-filled from manager, but editable for cross-pod transfers) -->
      <div class="mb-5">
        <label class="block text-sm font-medium text-dark-200 mb-2">Destination Pod</label>
        <select id="transfer-to-pod" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-indigo-500 transition-colors">
          ${podNames.map(p => `<option value="${p}">${p.replace(' - RoofIgnite','')}</option>`).join('')}
        </select>
        <p class="text-dark-500 text-[10px] mt-1">Auto-set from destination manager. Change if moving to a different pod.</p>
      </div>

      <!-- Transfer Summary & Button -->
      <div id="transfer-summary" class="mb-4"></div>

      <div class="flex justify-end gap-3">
        <button onclick="document.getElementById('transfer-modal').remove()" class="px-4 py-2.5 rounded-xl text-sm text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/50 transition-all">Cancel</button>
        <button id="transfer-execute-btn" onclick="executeTransfer()" disabled class="px-6 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
          Transfer Accounts
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function renderTransferAccountList() {
  const fromMgr = document.getElementById('transfer-from-mgr').value;
  const container = document.getElementById('transfer-account-list');
  transferSelectedAccounts = new Set();

  if (!fromMgr) {
    container.innerHTML = '';
    updateTransferSummary();
    return;
  }

  const accounts = allAccounts.filter(a => a.manager === fromMgr);
  if (accounts.length === 0) {
    container.innerHTML = '<p class="text-dark-500 text-sm py-3">No accounts under this manager.</p>';
    updateTransferSummary();
    return;
  }

  container.innerHTML = `
    <label class="block text-sm font-medium text-dark-200 mb-2">Select Accounts to Transfer</label>
    <div class="bg-dark-800/40 rounded-xl border border-dark-600/30 max-h-52 overflow-y-auto">
      <div class="px-3 py-2 border-b border-dark-600/30 sticky top-0 bg-dark-800/90 backdrop-blur-sm">
        <label class="flex items-center gap-2 cursor-pointer text-xs text-dark-300 hover:text-white transition-colors">
          <input type="checkbox" id="transfer-select-all" onchange="toggleTransferSelectAll(this.checked)" class="rounded border-dark-500 bg-dark-700 text-indigo-500 focus:ring-indigo-500/30">
          <span>Select All (${accounts.length})</span>
        </label>
      </div>
      ${accounts.map(a => {
        const isActive = hasActiveCycle(a);
        return `
        <label class="flex items-center gap-3 px-3 py-2 hover:bg-dark-700/40 cursor-pointer transition-colors border-b border-dark-700/20 last:border-0">
          <input type="checkbox" value="${a.name}" onchange="toggleTransferAccount('${a.name.replace(/'/g,"\\'")}', this.checked)" class="transfer-acct-cb rounded border-dark-500 bg-dark-700 text-indigo-500 focus:ring-indigo-500/30">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <div class="w-6 h-6 rounded-md ${isActive ? 'bg-green-500/15 text-green-400 border-green-500/20' : 'bg-dark-600/30 text-dark-500 border-dark-600/20'} border flex items-center justify-center text-[9px] font-bold">${a.name.charAt(0)}</div>
            <div class="min-w-0">
              <div class="text-white text-xs font-medium truncate">${a.name}</div>
              <div class="text-dark-500 text-[10px]">${a.pod ? a.pod.replace(' - RoofIgnite','') : '—'} ${isActive ? '' : '· Inactive'}</div>
            </div>
          </div>
        </label>`;
      }).join('')}
    </div>
  `;
  updateTransferSummary();
}

function toggleTransferSelectAll(checked) {
  const fromMgr = document.getElementById('transfer-from-mgr').value;
  const accounts = allAccounts.filter(a => a.manager === fromMgr);
  transferSelectedAccounts = checked ? new Set(accounts.map(a => a.name)) : new Set();
  document.querySelectorAll('.transfer-acct-cb').forEach(cb => cb.checked = checked);
  updateTransferSummary();
}

function toggleTransferAccount(name, checked) {
  if (checked) transferSelectedAccounts.add(name);
  else transferSelectedAccounts.delete(name);

  // Update "Select All" checkbox state
  const totalCbs = document.querySelectorAll('.transfer-acct-cb').length;
  const selectAll = document.getElementById('transfer-select-all');
  if (selectAll) {
    selectAll.checked = transferSelectedAccounts.size === totalCbs;
    selectAll.indeterminate = transferSelectedAccounts.size > 0 && transferSelectedAccounts.size < totalCbs;
  }
  updateTransferSummary();
}

function updateTransferPodDisplay() {
  const toMgr = document.getElementById('transfer-to-mgr').value;
  const podSelect = document.getElementById('transfer-to-pod');
  if (toMgr && managerPodMap[toMgr]) {
    podSelect.value = managerPodMap[toMgr];
  }
  updateTransferSummary();
}

function updateTransferSummary() {
  const fromMgr = document.getElementById('transfer-from-mgr')?.value;
  const toMgr = document.getElementById('transfer-to-mgr')?.value;
  const toPod = document.getElementById('transfer-to-pod')?.value;
  const count = transferSelectedAccounts.size;
  const summary = document.getElementById('transfer-summary');
  const btn = document.getElementById('transfer-execute-btn');

  const valid = fromMgr && toMgr && fromMgr !== toMgr && count > 0;
  if (btn) btn.disabled = !valid;

  if (!summary) return;

  if (!valid) {
    if (fromMgr && toMgr && fromMgr === toMgr) {
      summary.innerHTML = '<p class="text-yellow-400 text-xs">Source and destination manager must be different.</p>';
    } else if (count === 0 && fromMgr) {
      summary.innerHTML = '<p class="text-dark-500 text-xs">Select at least one account to transfer.</p>';
    } else {
      summary.innerHTML = '';
    }
    return;
  }

  const fromPod = managerPodMap[fromMgr] ? managerPodMap[fromMgr].replace(' - RoofIgnite','') : '?';
  const toPodLabel = toPod ? toPod.replace(' - RoofIgnite','') : '?';
  const crossPod = managerPodMap[fromMgr] !== toPod;

  summary.innerHTML = `
    <div class="bg-indigo-500/5 border border-indigo-500/15 rounded-xl p-3">
      <div class="flex items-center gap-3 text-sm">
        <div class="text-center">
          <div class="text-dark-400 text-[10px] uppercase tracking-wide">From</div>
          <div class="text-white font-semibold">${fromMgr}</div>
          <div class="text-dark-500 text-[10px]">${fromPod}</div>
        </div>
        <div class="flex-1 flex items-center justify-center">
          <div class="flex items-center gap-2 px-3 py-1 rounded-full ${crossPod ? 'bg-purple-500/15 border border-purple-500/20' : 'bg-indigo-500/10 border border-indigo-500/15'}">
            <span class="text-indigo-300 text-xs font-semibold">${count} account${count !== 1 ? 's' : ''}</span>
            <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </div>
        </div>
        <div class="text-center">
          <div class="text-dark-400 text-[10px] uppercase tracking-wide">To</div>
          <div class="text-white font-semibold">${toMgr}</div>
          <div class="text-dark-500 text-[10px]">${toPodLabel}</div>
        </div>
      </div>
      ${crossPod ? '<p class="text-purple-400 text-[10px] text-center mt-2 font-medium">Cross-pod transfer</p>' : ''}
    </div>
  `;
}

async function executeTransfer() {
  const fromMgr = document.getElementById('transfer-from-mgr').value;
  const toMgr = document.getElementById('transfer-to-mgr').value;
  const toPod = document.getElementById('transfer-to-pod').value;
  const count = transferSelectedAccounts.size;

  if (!fromMgr || !toMgr || fromMgr === toMgr || count === 0) return;

  // Disable button during transfer
  const btn = document.getElementById('transfer-execute-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Transferring...'; }

  const accountNames = [...transferSelectedAccounts];
  let successCount = 0;
  let failCount = 0;

  for (const name of accountNames) {
    const acct = allAccounts.find(a => a.name === name && a.manager === fromMgr);
    if (!acct) continue;

    // Update local state
    const oldMgr = acct.manager;
    const oldPod = acct.pod;
    acct.manager = toMgr;
    acct.pod = toPod;
    acct.cycles.forEach(c => { c.manager = toMgr; });

    // Sync to Sheet
    if (APPS_SCRIPT_URL) {
      const result = await writeToSheet('transferAccount', {
        name,
        adAccountId: acct.adAccountId || '',
        fromManager: oldMgr,
        toManager: toMgr,
        fromPod: oldPod,
        toPod: toPod
      }, { silent: true });

      // Fallback to updateManager if transferAccount action doesn't exist yet
      if (!result.ok && result.error && result.error.includes('Unknown action')) {
        const fallback = await writeToSheet('updateManager', { name, manager: toMgr }, { silent: true });
        if (fallback.ok) successCount++;
        else failCount++;
      } else if (result.ok) {
        successCount++;
      } else {
        failCount++;
      }
    } else {
      successCount++;
    }
  }

  // Rebuild managerPodMap
  managerPodMap = {};
  allAccounts.forEach(a => {
    if (a.manager && a.pod && !managerPodMap[a.manager]) {
      managerPodMap[a.manager] = a.pod;
    }
  });

  // Refresh UI
  renderSidebarManagers();
  renderAdminView();

  // Close modal
  const modal = document.getElementById('transfer-modal');
  if (modal) modal.remove();

  // Show result
  if (failCount === 0) {
    showToast(`Transferred ${successCount} account${successCount !== 1 ? 's' : ''} from ${fromMgr} to ${toMgr} ✓`, 'success');
  } else {
    showToast(`Transferred ${successCount}/${count} accounts. ${failCount} failed to sync to Sheet.`, 'warning');
  }
}

async function toggleAccountStatus(name) {
  const acct = allAccounts.find(a => a.name === name);
  if (!acct) return;

  acct.isPaused = !acct.isPaused;
  renderAdminView();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('toggleStatus', { name, isPaused: acct.isPaused });
    if (result.ok) {
      showToast(`${name}: ${acct.isPaused ? 'Paused' : 'Activated'} ✓ Saved`, acct.isPaused ? 'warning' : 'success');
    } else {
      showToast(`⚠️ ${name} toggled locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`${name}: ${acct.isPaused ? 'Paused' : 'Activated'} (local only)`, acct.isPaused ? 'warning' : 'success');
  }
}

// Greg toggle replaced by 3-mode system: setManagerGregMode() and setAccountGregMode()
// defined above in the Greg Configuration State section

async function saveCycleEdit(accountName, cycleIndex) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct || !acct.cycles[cycleIndex]) return;
  const c = acct.cycles[cycleIndex];

  const start = document.getElementById('ce-start')?.value;
  const end = document.getElementById('ce-end')?.value;
  const bGoal = document.getElementById('ce-bgoal')?.value;
  const gGoal = document.getElementById('ce-ggoal')?.value;
  const cpa = document.getElementById('ce-cpa')?.value;
  const daily = document.getElementById('ce-daily')?.value;
  const monthly = document.getElementById('ce-monthly')?.value;

  if (start) c.cycleStartDate = start;
  if (end) c.cycleEndDate = end;
  if (bGoal !== '') c.bookedGoal = parseFloat(bGoal) || null;
  if (gGoal !== '') c.gregGoal = parseFloat(gGoal) || null;
  if (cpa !== '') c.cpaGoal = parseFloat(cpa) || null;
  if (daily !== '') c.dailyBudget = parseFloat(daily) || null;
  if (monthly !== '') c.monthlyBudget = parseFloat(monthly) || null;

  adminEditingCycle.editIndex = null;
  renderAdminView();

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('updateCycle', {
      name: accountName, cycle: c.cycle,
      cycleStartDate: c.cycleStartDate, cycleEndDate: c.cycleEndDate,
      bookedGoal: c.bookedGoal, gregGoal: c.gregGoal, cpaGoal: c.cpaGoal,
      dailyBudget: c.dailyBudget, monthlyBudget: c.monthlyBudget
    });
    if (result.ok) {
      showToast(`Updated ${c.cycle} for ${accountName} ✓ Saved`, 'success');
    } else {
      showToast(`⚠️ ${c.cycle} updated locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`Updated ${c.cycle} for ${accountName} (local only)`, 'success');
  }
}

function openQuickEditModal(accountName, cycleName, vals) {
  const cycleLength = (vals.cycleStartDate && vals.cycleEndDate)
    ? Math.round((parseLocalDate(vals.cycleEndDate) - parseLocalDate(vals.cycleStartDate)) / 86400000)
    : 28;
  const modal = document.createElement('div');
  modal.id = 'quick-edit-modal';
  modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-lg w-full scale-in" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-base font-bold text-white">Edit Cycle</h2>
          <p class="text-[11px] text-dark-400 mt-0.5">${accountName} — ${cycleName}</p>
        </div>
        <button onclick="document.getElementById('quick-edit-modal').remove()" class="text-dark-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] text-dark-400 font-medium">CPA Goal</label>
          <input id="qe-cpa-goal" type="number" step="0.01" value="${vals.cpaGoal}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 font-medium">Booked Goal</label>
          <input id="qe-booked-goal" type="number" value="${vals.bookedGoal}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 font-medium">Cycle Length (days)</label>
          <input id="qe-cycle-length" type="number" value="${cycleLength}" data-original="${cycleLength}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 font-medium">Daily Budget</label>
          <input id="qe-daily" type="number" step="0.01" value="${vals.dailyBudget}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 font-medium">Monthly Budget</label>
          <input id="qe-monthly" type="number" step="0.01" value="${vals.monthlyBudget}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 font-medium">Cycle Start</label>
          <input id="qe-cycle-start" type="date" value="${vals.cycleStartDate}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
        <div class="sm:col-span-2">
          <label class="text-[10px] text-dark-400 font-medium">Cycle End</label>
          <input id="qe-cycle-end" type="date" value="${vals.cycleEndDate}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 mt-1 focus:outline-none focus:border-brand-500 transition-colors" />
        </div>
      </div>
      <div class="text-[9px] text-dark-500 mt-2">Changing cycle length auto-adjusts end date from start date</div>
      <div class="flex gap-2 mt-4">
        <button onclick="document.getElementById('quick-edit-modal').remove()" class="flex-1 py-2 rounded-xl text-xs font-semibold text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-700/80 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="quickEditCycle('${accountName.replace(/'/g,"\\'")}','${cycleName.replace(/'/g,"\\'")}')" class="flex-1 py-2 rounded-xl text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 shadow-lg shadow-brand-500/20 transition-all">Save Changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function quickEditCycle(accountName, cycleName) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const cpaGoal = document.getElementById('qe-cpa-goal')?.value;
  const bookedGoal = document.getElementById('qe-booked-goal')?.value;
  const cycleLengthEl = document.getElementById('qe-cycle-length');
  const cycleLength = cycleLengthEl?.value;
  const originalLength = cycleLengthEl?.dataset?.original || '';
  const daily = document.getElementById('qe-daily')?.value;
  const monthly = document.getElementById('qe-monthly')?.value;
  const cycleStart = document.getElementById('qe-cycle-start')?.value;
  const cycleEnd = document.getElementById('qe-cycle-end')?.value;

  // Close the modal
  document.getElementById('quick-edit-modal')?.remove();

  // Update local data (gregGoal intentionally excluded — edit via Greg card only)
  if (cpaGoal !== '') c.cpaGoal = parseFloat(cpaGoal) || null;
  if (bookedGoal !== '') c.bookedGoal = parseFloat(bookedGoal) || null;
  if (daily !== '') c.dailyBudget = parseFloat(daily) || null;
  if (monthly !== '') c.monthlyBudget = parseFloat(monthly) || null;

  // Handle dates: apply cycle length override ONLY if the user changed it
  if (cycleStart) c.cycleStartDate = cycleStart;
  if (cycleEnd) c.cycleEndDate = cycleEnd;
  const cycleLengthChanged = (cycleLength !== originalLength && cycleLength !== '');
  if (cycleLengthChanged && c.cycleStartDate) {
    // User explicitly changed cycle length → recalculate end date from start
    const startMs = parseLocalDate(c.cycleStartDate).getTime();
    c.cycleEndDate = new Date(startMs + parseInt(cycleLength) * 86400000).toLocaleDateString('en-CA');
  }

  // Also update top-level account fields for convenience
  if (c.cpaGoal !== undefined) acct.cpaGoal = c.cpaGoal;
  if (c.bookedGoal !== undefined) acct.bookedGoal = c.bookedGoal;
  if (c.dailyBudget !== undefined) acct.dailyBudget = c.dailyBudget;
  if (c.monthlyBudget !== undefined) acct.monthlyBudget = c.monthlyBudget;

  // Re-render to show changes (don't navigate — that reloads the page and loses local edits)
  if (document.getElementById('view-account')) {
    renderAccountDetail(accountName, acct.adAccountId);
  }

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('updateCycle', {
      name: accountName, cycle: c.cycle,
      cycleStartDate: c.cycleStartDate, cycleEndDate: c.cycleEndDate,
      bookedGoal: c.bookedGoal, gregGoal: c.gregGoal, cpaGoal: c.cpaGoal,
      dailyBudget: c.dailyBudget, monthlyBudget: c.monthlyBudget
    });
    if (result.ok) {
      showToast(`Updated ${c.cycle} for ${accountName} ✓ Saved`, 'success');
    } else {
      showToast(`⚠️ Failed to save to Sheet: ${result.error || 'unknown error'}`, 'error');
    }
  } else {
    showToast(`Updated ${c.cycle} for ${accountName} (local only)`, 'success');
  }
}

async function saveCpcSettings(accountName, cycleName) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const multVal = document.getElementById('qe-cpc-mult')?.value;
  c.cpcMultiplier = multVal !== '' ? parseFloat(multVal) || null : null;

  if (document.getElementById('view-account')) {
    renderAccountDetail(accountName, acct.adAccountId);
  }

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('updateCycle', {
      name: accountName, cycle: c.cycle,
      cycleStartDate: c.cycleStartDate, cycleEndDate: c.cycleEndDate,
      bookedGoal: c.bookedGoal, gregGoal: c.gregGoal, cpaGoal: c.cpaGoal,
      dailyBudget: c.dailyBudget, monthlyBudget: c.monthlyBudget,
      cpcMultiplier: c.cpcMultiplier
    });
    if (result.ok) {
      showToast(`CPC Multiplier → ${c.cpcMultiplier ? c.cpcMultiplier + '×' : 'default (1.4×)'} for ${accountName} ✓ Saved`, 'success');
    } else {
      showToast(`⚠️ CPC settings updated locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`CPC Multiplier → ${c.cpcMultiplier ? c.cpcMultiplier + '×' : 'default'} for ${accountName} (local only)`, 'success');
  }
}

async function saveGregGoal(accountName, cycleName) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;
  const c = acct.cycles.find(cy => cy.cycle === cycleName);
  if (!c) return;

  const val = document.getElementById('qe-greg-goal')?.value;
  if (val === '' || val === undefined) { showToast('Enter a Greg Goal value first', 'error'); return; }

  c.gregGoal = parseFloat(val) || null;
  acct.gregGoal = c.gregGoal;

  if (document.getElementById('view-account')) {
    renderAccountDetail(accountName, acct.adAccountId);
  }

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('updateCycle', {
      name: accountName, cycle: c.cycle,
      cycleStartDate: c.cycleStartDate, cycleEndDate: c.cycleEndDate,
      bookedGoal: c.bookedGoal, gregGoal: c.gregGoal, cpaGoal: c.cpaGoal,
      dailyBudget: c.dailyBudget, monthlyBudget: c.monthlyBudget
    });
    if (result.ok) {
      showToast(`Greg Goal → $${c.gregGoal} for ${accountName} ✓ Saved`, 'success');
    } else {
      showToast(`⚠️ Greg Goal updated locally, but failed to save to Sheet`, 'error');
    }
  } else {
    showToast(`Greg Goal → $${c.gregGoal} for ${accountName} (local only)`, 'success');
  }
}

function addNewCycle(accountName) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;

  const prev = acct.cycles.length ? acct.cycles[acct.cycles.length - 1] : null;
  // Parse the highest cycle number from existing cycle names (handles gaps/duplicates)
  const maxCycleNum = acct.cycles.reduce((max, c) => {
    const m = String(c.cycle || '').match(/cycle\s*(\d+)/i);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const nextNum = maxCycleNum + 1;
  // Default start = previous cycle end, or today
  const defaultStart = prev?.cycleEndDate || new Date().toISOString().split('T')[0];

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-6 max-w-sm w-full border border-brand-500/30 modal-inner" onclick="event.stopPropagation()">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
          <svg class="w-5 h-5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
        </div>
        <div>
          <h3 class="text-white font-bold text-lg">Add Cycle ${nextNum}</h3>
          <p class="text-dark-400 text-xs">${esc(acct.name)}</p>
        </div>
      </div>

      <div class="space-y-3">
        <div>
          <label class="text-[10px] text-dark-400 uppercase tracking-wider">Daily Budget ($)</label>
          <input id="nc-daily" type="number" step="0.01" value="${prev?.dailyBudget || ''}" placeholder="e.g. 100" class="w-full mt-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 uppercase tracking-wider">Booked Goal (Appointments)</label>
          <input id="nc-booked" type="number" value="${prev?.bookedGoal || ''}" placeholder="e.g. 20" class="w-full mt-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <label class="text-[10px] text-dark-400 uppercase tracking-wider">Cycle Start Date</label>
          <input id="nc-start" type="date" value="${defaultStart}" class="w-full mt-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        </div>
        <div class="text-[10px] text-dark-500">28-day cycle · CPA Goal & Greg Goal carry over from previous cycle</div>
      </div>

      <div class="flex justify-end gap-3 mt-5">
        <button onclick="this.closest('.fixed').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 hover:bg-dark-600/50 border border-dark-600/30 transition-all">Cancel</button>
        <button onclick="executeAddCycle('${esc(accountName)}')" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 shadow-lg shadow-brand-500/20 transition-all">Add Cycle</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => { const el = document.getElementById('nc-daily'); if (el) el.focus(); }, 50);
}

async function executeAddCycle(accountName) {
  const acct = allAccounts.find(a => a.name === accountName);
  if (!acct) return;

  const dailyBudget = parseFloat(document.getElementById('nc-daily')?.value) || null;
  const bookedGoal = parseInt(document.getElementById('nc-booked')?.value) || null;
  const startDate = document.getElementById('nc-start')?.value || new Date().toISOString().split('T')[0];

  // Confirmation — prevent accidental cycle creation
  if (!confirm(`Add a new cycle to "${accountName}"?\n\nDaily Budget: ${dailyBudget ? '$' + dailyBudget : '(none)'}\nBooked Goal: ${bookedGoal || '(none)'}\nStart: ${startDate}`)) return;
  const endDate = new Date(new Date(startDate).getTime() + 28 * 86400000).toISOString().split('T')[0];
  const monthlyBudget = dailyBudget ? Math.round(dailyBudget * 28 * 100) / 100 : null;

  const prev = acct.cycles.length ? acct.cycles[acct.cycles.length - 1] : null;
  // Parse highest existing cycle number from names (not array length — handles gaps)
  const maxCycleNum = acct.cycles.reduce((max, c) => {
    const m = String(c.cycle || '').match(/cycle\s*(\d+)/i);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const nextNum = maxCycleNum + 1;
  const cycleName = 'Cycle ' + nextNum;

  const newCycle = {
    account: accountName,
    adAccountId: acct.adAccountId,
    pod: acct.pod,
    manager: acct.manager,
    cycle: cycleName,
    cycleStartDate: startDate,
    cycleEndDate: endDate,
    bookedGoal: bookedGoal,
    gregGoal: prev?.gregGoal || null,
    totalLeads: null, osaPct: null, bookedAppts: null, estBookedAppts: null,
    cpaGoal: prev?.cpaGoal || acct.cpaGoal || null,
    cpa: null,
    dailyBudget: dailyBudget,
    monthlyBudget: monthlyBudget,
    amountSpent: null,
    linkCTR: null, linkCPC: null, cpm: null, frequency: null, surveyPct: null,
    cpcMedian: null, cpcMultiplier: prev?.cpcMultiplier || null,
    accountManager: acct.manager, notes: '', goodToBill: 'No', billed: 'No', billingNotes: ''
  };

  // Close modal
  document.getElementById('nc-daily')?.closest('.fixed')?.remove();

  // Add locally
  acct.cycles.push(newCycle);

  // Re-render whatever view we're on without breaking it
  if (document.getElementById('view-account')) {
    renderAccountDetail(accountName);
  } else if (document.getElementById('view-admin')) {
    renderAdminView();
  }

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('addCycle', newCycle);
    if (result.ok) {
      showToast(`${cycleName} added to ${accountName} ✓`, 'success');
    } else {
      const errMsg = result.error || 'Unknown error';
      if (errMsg.includes('Unknown action')) {
        showToast(`${cycleName} added locally. To sync: redeploy Apps Script (New Version)`, 'warning');
      } else {
        showToast(`⚠️ ${cycleName} added locally, but Sheet sync failed: ${errMsg}`, 'error');
      }
    }
  } else {
    showToast(`${cycleName} added to ${accountName} (local only)`, 'warning');
  }
}

// ═══ Toast Notification ═══

function showToast(message, type = 'info') {
  const colors = { success: 'from-green-500 to-green-600', error: 'from-red-500 to-red-600', warning: 'from-yellow-500 to-yellow-600', info: 'from-blue-500 to-blue-600' };
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-xl md:bottom-6 flex items-start gap-3 px-5 py-3 rounded-xl shadow-2xl text-white text-sm font-medium bg-gradient-to-r ' + (colors[type] || colors.info);
  toast.style.cssText = 'z-index:2147483647; animation: slideIn 0.3s ease-out; opacity: 0; transform: translateY(20px); word-break: break-word;';
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
const READ_ONLY_ACTIONS = ['getSheetList', 'getSlackConfig', 'getSlackNotifyToggles', 'getPodRegistry', 'listCreativeFiles', 'getClientLocale', 'checkClientFolder', 'getCreativeQueue', 'getMetaToken'];

function showWriteProgressModal_(action) {
  const label = WRITE_ACTION_LABELS[action] || 'Saving changes';
  const overlay = document.createElement('div');
  overlay.id = 'write-progress-modal';
  overlay.className = 'fixed inset-0 z-[999] flex items-center justify-center';
  overlay.style.cssText = 'background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
  overlay.innerHTML = `
    <div class="glass rounded-2xl p-8 max-w-sm w-full mx-4 text-center scale-in" style="border:1px solid rgba(212,168,67,0.2);box-shadow:0 0 40px rgba(212,168,67,0.1);">
      <div class="relative mx-auto mb-5" style="width:48px;height:48px;">
        <div style="width:48px;height:48px;border:3px solid rgba(100,116,139,0.2);border-top-color:#d4a843;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
      </div>
      <p class="text-white text-sm font-semibold mb-1">${label}...</p>
      <p class="text-dark-400 text-xs">Syncing with Google Sheets — do not close this page</p>
      <div class="mt-4 w-full bg-dark-700/50 rounded-full h-1 overflow-hidden">
        <div class="h-full rounded-full" style="background:linear-gradient(90deg,#d4a843,#e0bc5e);animation:progressPulse 1.5s ease-in-out infinite;width:100%;"></div>
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
  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!stored) { showLoginGate(); return; }

  try {
    const user = JSON.parse(stored);
    const ageMs = Date.now() - (user.timestamp || 0);
    if (ageMs > AUTH_TTL_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      showLoginGate();
      return;
    }
    // Session valid — show dashboard
    onAuthSuccess(user, false);
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    showLoginGate();
  }
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
    if (user.picture) { pic.src = user.picture; pic.style.display = ''; } else { pic.style.display = 'none'; }
  }

  // v2: Each page registers its init function on window._onAuthReady
  if (typeof window._onAuthReady === 'function') {
    window._onAuthReady();
  }
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
}

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
    html += '<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:20;width:3px;height:120px;background:linear-gradient(to bottom,#d4a843,#d4a843 85%,transparent);"></div>';
    html += '<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);z-index:21;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid #d4a843;"></div>';
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
    strip.parentElement.style.boxShadow = '0 0 20px rgba(212,168,67,0.3)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 50);
  }, 80);

  // Slow down ticks
  setTimeout(() => { clearInterval(tickInterval); tickInterval = setInterval(() => {
    playTick(600 + Math.random() * 200, 0.1);
    strip.parentElement.style.boxShadow = '0 0 30px rgba(212,168,67,0.4)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 100);
  }, 200); }, 3000);

  // Even slower near the end
  setTimeout(() => { clearInterval(tickInterval); tickInterval = setInterval(() => {
    playTick(500, 0.12);
    strip.parentElement.style.boxShadow = '0 0 35px rgba(212,168,67,0.5)';
    setTimeout(() => { strip.parentElement.style.boxShadow = ''; }, 150);
  }, 400); }, 5000);

  // When done
  setTimeout(() => {
    clearInterval(tickInterval);
    playWinSound();
    strip.parentElement.style.boxShadow = '0 0 40px rgba(212,168,67,0.6)';
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

// ═══════════════════════════════════════════════
// INIT — v2: disabled, each page handles its own init
// ═══════════════════════════════════════════════
// checkExistingSession();
// ═══════════════════════════════════════════════
// CREATIVE FORGE MODAL
// ═══════════════════════════════════════════════

let _cfModalClient = null;
let _cfLocaleCache = {};
let _cfRoofTypesCache = {};
let _cfFolderExists = {};   // clientName → true (skip checkClientFolder after first confirmation)
let _cfFileListCache = {};  // "clientName|subfolder" → { files: [...], ts: Date.now() }
const CF_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — file lists stay cached this long
const CF_VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const CF_SECTION_LIMITS = { reps: 99, logos: 1, vehicles: 3 }; // reps limit = 99 (enforced per unique rep name, max 3 reps)
const CF_MAX_REPS = 3;
const CF_ROOF_TYPES = [
  { key: 'shingle', label: 'Shingle (asphalt)' },
  { key: 'tile', label: 'Tile (clay/concrete)' },
  { key: 'metal', label: 'Metal (standing seam)' },
  { key: 'flat', label: 'Flat (TPO/EPDM)' },
  { key: 'slate', label: 'Slate' },
  { key: 'woodshake', label: 'Wood Shake' },
];

const CF_SECTIONS = [
  { key: 'reps', label: 'Approved Reps', subfolder: 'Approved AI References/Reps', hint: 'Photos of company representatives' },
  { key: 'logos', label: 'Approved Logos', subfolder: 'Approved AI References/Logos', hint: 'Company logo files' },
  { key: 'vehicles', label: 'Approved Vehicles', subfolder: 'Approved AI References/Vehicles', hint: 'Company truck/vehicle photos' },
  { key: 'topPerformers', label: 'Top Performers', subfolder: 'Top Performers', hint: 'Best-performing ad creatives', noUpload: true },
];

async function openCreativeForgeModal(clientName) {
  _cfModalClient = clientName;

  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'cf-modal';
  modal.className = 'fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto';
  modal.style.background = 'rgba(0,0,0,0.7)';
  modal.style.backdropFilter = 'blur(4px)';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="w-full max-w-4xl mx-4 my-8 rounded-2xl" style="background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.9));border:1px solid rgba(148,163,184,0.1);">
      <div class="flex items-center justify-between p-6 border-b border-dark-600/30">
        <div>
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            Creative Forge
          </h2>
          <p class="text-dark-400 text-sm mt-1">${clientName}</p>
        </div>
        <button onclick="document.getElementById('cf-modal').remove()" class="text-dark-400 hover:text-white transition-colors p-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="cf-modal-body" class="p-6">
        <div class="flex items-center justify-center py-12">
          <div class="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
          <span class="ml-3 text-dark-400 text-sm">Loading creative assets...</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Load content
  await loadCreativeForgeContent(clientName);
}

async function loadCreativeForgeContent(clientName) {
  const body = document.getElementById('cf-modal-body');
  if (!body) return;

  // Run folder check + locale fetch in parallel (both are read-only)
  // Skip folder check entirely if we've already confirmed it exists this session
  const folderKnown = _cfFolderExists[clientName];
  const [folderOk, locale] = await Promise.all([
    // Folder check/create
    (async () => {
      if (folderKnown) return true;
      const checkResult = await writeToSheet('checkClientFolder', { clientName }, { silent: true });
      if (checkResult.ok && checkResult.exists) { _cfFolderExists[clientName] = true; return true; }
      if (checkResult.ok && !checkResult.exists) {
        const ensureResult = await writeToSheet('createClientFolder', { clientName }, { silent: true });
        if (ensureResult.ok) { _cfFolderExists[clientName] = true; return true; }
        return ensureResult;
      }
      return checkResult;
    })(),
    // Locale fetch (cached in memory)
    (async () => {
      if (_cfLocaleCache[clientName] !== undefined) return _cfLocaleCache[clientName];
      try {
        const localeResult = await writeToSheet('getClientLocale', { clientName }, { silent: true });
        const loc = (localeResult.ok && localeResult.locale) ? localeResult.locale : '';
        _cfLocaleCache[clientName] = loc;
        return loc;
      } catch(e) { return ''; }
    })(),
  ]);

  if (folderOk !== true) {
    const err = folderOk?.error || 'Unknown error';
    body.innerHTML = `
      <div class="text-center py-12">
        <svg class="w-12 h-12 text-dark-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <p class="text-dark-300 text-lg font-semibold mb-2">Could not set up folders for "${clientName}"</p>
        <p class="text-dark-500 text-sm mb-6">${err}</p>
        <button onclick="loadCreativeForgeContent('${esc(clientName)}')" class="px-6 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 shadow-lg shadow-purple-500/20 transition-all">
          Retry
        </button>
      </div>
    `;
    return;
  }

  // Load roof types from cache or fetch
  let roofTypes = _cfRoofTypesCache[clientName];
  if (roofTypes === undefined) {
    try {
      const rtResult = await writeToSheet('getRoofTypes', { clientName }, { silent: true });
      roofTypes = (rtResult.ok && rtResult.roofTypes) ? rtResult.roofTypes : '';
      _cfRoofTypesCache[clientName] = roofTypes;
    } catch(e) { roofTypes = ''; }
  }
  const activeRoofTypes = roofTypes ? roofTypes.split(',') : CF_ROOF_TYPES.map(r => r.key); // all checked by default

  // Build the sections
  let html = `
    <!-- Locale Setting -->
    <div class="mb-6">
      <label class="text-xs uppercase tracking-wider text-dark-400 font-semibold mb-2 block">Client Location / Locale</label>
      <div class="flex gap-2">
        <input type="text" id="cf-locale-input" value="${locale}" placeholder="e.g. Fort Lauderdale, Florida (South Florida)" class="flex-1 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-dark-200 px-4 py-2.5 focus:outline-none focus:border-purple-500 transition-colors" />
        <button onclick="saveCreativeForgeLocale('${esc(clientName)}')" class="px-4 py-2 rounded-xl text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all">Save</button>
      </div>
    </div>
    <hr class="border-dark-600/30 mb-6">
  `;

  // Add each image section
  for (const section of CF_SECTIONS) {
    const isReps = section.key === 'reps';
    const disclaimer = isReps ? `<div class="mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90">
      <strong>Rep Photo Guidelines:</strong> Upload a clear, well-lit headshot of the rep's face (minimum). A full-body shot is recommended for better likeness. Max 3 reps, multiple photos per rep allowed.
    </div>` : '';
    html += `
    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <div>
          <h3 class="text-sm font-semibold text-white">${section.label} <span id="cf-count-${section.key}" class="text-dark-500 text-xs font-normal"></span></h3>
          <p class="text-xs text-dark-500">${section.hint}</p>
        </div>
        ${section.noUpload ? '' : `<label class="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all cursor-pointer">
          <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Upload
          <input type="file" accept=".jpg,.jpeg,.png" multiple class="hidden" onchange="handleCreativeUpload(event, '${esc(clientName)}', '${section.subfolder}', '${section.key}')" />
        </label>`}
      </div>
      ${disclaimer}
      <div id="cf-grid-${section.key}" class="grid grid-cols-4 md:grid-cols-6 gap-3 rounded-xl border-2 border-dashed border-transparent transition-colors" ondragover="cfDragOver(event, '${section.key}')" ondragleave="cfDragLeave(event, '${section.key}')" ondrop="cfDrop(event, '${esc(clientName)}', '${section.subfolder}', '${section.key}')">
        <div class="col-span-full text-center py-4 text-dark-500 text-xs">Loading...</div>
      </div>
    </div>
    `;
  }

  // Add Generate section
  html += `
    <hr class="border-dark-600/30 mb-6">
    <div class="mb-4">
      <h3 class="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Generate Creatives
      </h3>
      <p class="text-xs text-dark-500 mb-4">Add a generation job to the queue</p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1 block">Image Count</label>
          <input type="number" id="cf-gen-count" value="12" min="1" max="30" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2 focus:outline-none focus:border-emerald-500" />
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1 block">Priority</label>
          <select id="cf-gen-priority" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2 focus:outline-none focus:border-emerald-500">
            <option value="normal">Normal</option>
            <option value="rush">Rush (front of queue)</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1 block">Scene Type</label>
          <select id="cf-gen-scene" onchange="cfToggleCustomSchedule()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2 focus:outline-none focus:border-emerald-500">
            <option value="auto">Auto (from top performers)</option>
            <option value="selfies">Selfies only</option>
            <option value="property">Property only</option>
            <option value="homes">Homes only (no people/trucks)</option>
            <option value="crew">Crew only</option>
            <option value="mixed">Mixed (all types)</option>
            <option value="custom">Custom schedule...</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1 block">Season</label>
          <select id="cf-gen-season" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2 focus:outline-none focus:border-emerald-500">
            <option value="auto">Auto (current)</option>
            <option value="spring">Spring</option>
            <option value="summer">Summer</option>
            <option value="fall">Fall</option>
            <option value="winter">Winter</option>
          </select>
        </div>
      </div>
      <div id="cf-custom-schedule" class="mb-3 hidden">
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-2 block">Custom Scene Mix <span id="cf-custom-total" class="text-emerald-400 ml-1">0</span> / <span id="cf-custom-target" class="text-dark-500">12</span></label>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-2">
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Selfies</label>
            <input type="number" data-cf-cat="selfie" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Portraits</label>
            <input type="number" data-cf-cat="portrait" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Property</label>
            <input type="number" data-cf-cat="property" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Aerial</label>
            <input type="number" data-cf-cat="aerial" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Crew</label>
            <input type="number" data-cf-cat="labour" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
          <div class="text-center">
            <label class="text-[9px] text-dark-400 block mb-0.5">Customer</label>
            <input type="number" data-cf-cat="customer" min="0" max="30" value="0" oninput="cfUpdateCustomTotal()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white text-center px-1 py-1.5 focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
      </div>
      <div class="mb-3">
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1 block">Prompt Override (optional)</label>
        <textarea id="cf-gen-notes" rows="2" placeholder="Overrides all scene rules — e.g. all roofs should be shingle not tile, no trucks, only blonde reps..." class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-dark-200 px-3 py-2 focus:outline-none focus:border-emerald-500 resize-none"></textarea>
      </div>
      <div class="mb-3">
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-2 block">Allowed Roof Types</label>
        <div class="flex flex-wrap gap-2" id="cf-roof-types">
          ${CF_ROOF_TYPES.map(rt => `<label class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${activeRoofTypes.includes(rt.key) ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-dark-800/60 text-dark-400 border border-dark-600/30'}">
            <input type="checkbox" value="${rt.key}" ${activeRoofTypes.includes(rt.key) ? 'checked' : ''} onchange="cfSaveRoofTypes('${esc(clientName)}')" class="hidden" />
            <span class="w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${activeRoofTypes.includes(rt.key) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-dark-500'}">${activeRoofTypes.includes(rt.key) ? '✓' : ''}</span>
            ${rt.label}
          </label>`).join('')}
        </div>
      </div>
      <button onclick="submitCreativeForgeJob('${esc(clientName)}')" class="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all">
        <svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Add to Queue
      </button>
    </div>

    <!-- Queue Status -->
    <div id="cf-queue-status" class="mb-4">
      <h4 class="text-xs uppercase tracking-wider text-dark-400 font-semibold mb-2">Recent Jobs</h4>
      <div class="text-xs text-dark-500">Loading queue...</div>
    </div>
  `;

  body.innerHTML = html;

  // Load files for each section in parallel
  await Promise.all(CF_SECTIONS.map(s => loadCreativeSection(clientName, s.subfolder, s.key)));

  // Load queue status
  loadCreativeQueueStatus(clientName);
}

async function loadCreativeSection(clientName, subfolder, key) {
  const grid = document.getElementById('cf-grid-' + key);
  if (!grid) return;

  // Check in-memory cache first (avoids Apps Script round-trip)
  const cacheKey = clientName + '|' + subfolder;
  const cached = _cfFileListCache[cacheKey];
  let files;
  if (cached && (Date.now() - cached.ts) < CF_CACHE_TTL) {
    files = cached.files;
  } else {
    const result = await writeToSheet('listCreativeFiles', { clientName, subfolder }, { silent: true });
    if (!result.ok) {
      grid.innerHTML = '<div class="col-span-full text-center py-4 text-red-400 text-xs">Error loading files</div>';
      return;
    }
    files = result.files || [];
    _cfFileListCache[cacheKey] = { files, ts: Date.now() };
  }
  // Update count badge
  const countEl = document.getElementById('cf-count-' + key);
  if (countEl) countEl.textContent = files.length > 0 ? `(${files.length})` : '';

  if (files.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-4 text-dark-500 text-xs">No files yet — upload or drag images here</div>';
    return;
  }

  // For reps, group by name prefix (e.g. "Cole_headshot.jpg" → group "Cole")
  if (key === 'reps') {
    const groups = {};
    for (const f of files) {
      const prefix = f.name.includes('_') ? f.name.split('_')[0] : 'Ungrouped';
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(f);
    }
    let html = '';
    for (const [repName, repFiles] of Object.entries(groups)) {
      html += `<div class="col-span-full text-xs font-semibold text-purple-300 mt-2 mb-1 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>${repName} (${repFiles.length} photo${repFiles.length > 1 ? 's' : ''})</div>`;
      html += repFiles.map(f => cfRenderRepTile(f, clientName, subfolder, key)).join('');
    }
    grid.innerHTML = html;
    return;
  }

  grid.innerHTML = files.map(f => cfRenderImageTile(f, clientName, subfolder, key)).join('');
}

function cfRenderImageTile(f, clientName, subfolder, key) {
  return `<div class="relative group rounded-xl overflow-hidden border border-dark-600/30 hover:border-purple-500/30 transition-all" style="aspect-ratio:1;">
      <img src="${f.thumbnailUrl}" alt="${f.name}" class="w-full h-full object-cover" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><rect fill=\\'%231e293b\\' width=\\'100\\' height=\\'100\\'/><text x=\\'50\\' y=\\'55\\' text-anchor=\\'middle\\' fill=\\'%2364748b\\' font-size=\\'12\\'>No preview</text></svg>'" />
      <button onclick="event.stopPropagation();deleteCreativeFile('${f.id}', '${esc(clientName)}', '${subfolder}', '${key}')" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:#ef4444;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;z-index:20;border:none;cursor:pointer;line-height:1;" title="Delete">×</button>
      <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer" onclick="event.stopPropagation();showImagePreview('${f.thumbnailUrl.replace('=w200','=w800')}', '${esc(f.name)}')">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
      </div>
      <div class="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] text-dark-200 truncate">${f.name}</div>
    </div>`;
}

function cfRenderRepTile(f, clientName, subfolder, key) {
  return `<div class="relative group rounded-xl overflow-hidden border border-dark-600/30 hover:border-purple-500/30 transition-all" style="aspect-ratio:1;">
      <img src="${f.thumbnailUrl}" alt="${f.name}" class="w-full h-full object-cover" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><rect fill=\\'%231e293b\\' width=\\'100\\' height=\\'100\\'/><text x=\\'50\\' y=\\'55\\' text-anchor=\\'middle\\' fill=\\'%2364748b\\' font-size=\\'12\\'>No preview</text></svg>'" />
      <button onclick="event.stopPropagation();deleteCreativeFile('${f.id}', '${esc(clientName)}', '${subfolder}', '${key}')" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:#ef4444;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;z-index:20;border:none;cursor:pointer;line-height:1;" title="Delete">×</button>
      <button onclick="event.stopPropagation();cfReassignRep('${f.id}', '${esc(f.name)}', '${esc(clientName)}', '${subfolder}', '${key}')" style="position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#8b5cf6;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;z-index:20;border:none;cursor:pointer;line-height:1;" title="Reassign to different rep">↔</button>
      <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer" onclick="event.stopPropagation();showImagePreview('${f.thumbnailUrl.replace('=w200','=w800')}', '${esc(f.name)}')">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
      </div>
      <div class="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] text-dark-200 truncate">${f.name}</div>
    </div>`;
}

async function cfReassignRep(fileId, fileName, clientName, subfolder, key) {
  const existingReps = cfGetExistingRepNames();
  const currentRep = fileName.includes('_') ? fileName.split('_')[0] : null;
  const repName = await cfShowRepWizard(existingReps);
  if (!repName || repName === currentRep) return;

  // Build new filename: replace old prefix with new rep name
  const baseName = fileName.includes('_') ? fileName.substring(fileName.indexOf('_') + 1) : fileName;
  const newName = repName + '_' + baseName;

  showToast('Reassigning to ' + repName + '...', 'info');

  // Rename on Drive = copy with new name + delete old (Drive API doesn't have rename-in-place via Apps Script)
  // We'll download the file data, re-upload with new name, delete old
  // Actually simpler: use Drive API PATCH to rename
  const result = await writeToSheet('renameCreativeFile', { fileId, newName }, { silent: true });
  if (result.ok) {
    showToast('Reassigned to ' + repName, 'success');
    delete _cfFileListCache[clientName + '|' + subfolder];
    await loadCreativeSection(clientName, subfolder, key);
  } else {
    showToast('Reassign failed: ' + (result.error || 'Unknown'), 'error');
  }
}

// ═══ File validation helper ═══
function cfValidateFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!CF_VALID_EXTENSIONS.includes(ext)) {
    showToast(`"${file.name}" rejected — only .jpg, .jpeg, .png files are accepted`, 'error');
    return false;
  }
  return true;
}

function cfCheckResolution(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      if (img.width < 512 || img.height < 512) {
        showToast(`"${file.name}" is ${img.width}×${img.height} — low resolution, results may be affected`, 'warning');
      }
      URL.revokeObjectURL(img.src);
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(); };
    img.src = URL.createObjectURL(file);
  });
}

// ═══ Section limit check ═══
function cfCheckSectionLimit(key) {
  const cacheKey = _cfModalClient + '|' + CF_SECTIONS.find(s => s.key === key)?.subfolder;
  const cached = _cfFileListCache[cacheKey];
  const currentCount = cached ? cached.files.length : 0;
  if (key === 'logos' && currentCount >= CF_SECTION_LIMITS.logos) {
    showToast('Maximum 1 logo file — delete the existing logo first', 'error');
    return false;
  }
  if (key === 'vehicles' && currentCount >= CF_SECTION_LIMITS.vehicles) {
    showToast('Maximum 3 vehicle photos', 'error');
    return false;
  }
  return true;
}

function cfGetExistingRepNames() {
  const cacheKey = _cfModalClient + '|Approved AI References/Reps';
  const cached = _cfFileListCache[cacheKey];
  if (!cached) return [];
  const names = new Set();
  for (const f of cached.files) {
    if (f.name.includes('_')) names.add(f.name.split('_')[0]);
  }
  return [...names];
}

// ═══ Rep wizard — asks which rep the photo belongs to ═══
function cfShowRepWizard(existingReps) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 flex items-center justify-center p-4';
    overlay.style.cssText = 'z-index:10000;background:rgba(0,0,0,0.35);backdrop-filter:blur(2px);';

    function dismiss() { overlay.remove(); resolve(null); }
    overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };

    overlay.innerHTML = `<div class="cf-rep-wizard rounded-2xl p-6 max-w-sm w-full shadow-2xl" style="background:rgba(15,23,42,0.97);border:1px solid rgba(148,163,184,0.15);">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-white font-bold">Which rep is this photo of?</h3>
        <button class="cf-rep-close text-dark-400 hover:text-white transition-colors p-1" title="Close">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="text-dark-400 text-xs mb-4">Select an existing rep or add a new one</p>
      ${existingReps.length > 0 ? `<div class="flex flex-wrap gap-2 mb-4">${existingReps.map(n => `<button class="cf-rep-pick px-4 py-2 rounded-lg text-sm font-semibold text-white bg-purple-500/30 border border-purple-500/40 hover:bg-purple-500/50 transition-all" data-rep="${esc(n)}">${n}</button>`).join('')}</div>` : ''}
      <div class="flex gap-2">
        <input type="text" id="cf-new-rep-name" placeholder="New rep name..." class="flex-1 bg-dark-800/80 border border-dark-600/50 rounded-lg text-sm text-white px-3 py-2 focus:outline-none focus:border-purple-500" />
        <button id="cf-new-rep-btn" class="px-4 py-2 rounded-lg text-sm font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all">Add</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    // Close button (X)
    overlay.querySelector('.cf-rep-close').addEventListener('click', dismiss);
    // Existing rep buttons
    overlay.querySelectorAll('.cf-rep-pick').forEach(btn => {
      btn.addEventListener('click', () => { overlay.remove(); resolve(btn.dataset.rep); });
    });
    // New rep button
    document.getElementById('cf-new-rep-btn').addEventListener('click', () => {
      const name = document.getElementById('cf-new-rep-name').value.trim();
      if (!name) { showToast('Enter a rep name', 'warning'); return; }
      const existing = cfGetExistingRepNames();
      if (existing.length >= CF_MAX_REPS && !existing.includes(name)) {
        showToast(`Maximum ${CF_MAX_REPS} reps — delete an existing rep's photos first`, 'error');
        return;
      }
      overlay.remove();
      resolve(name);
    });
    document.getElementById('cf-new-rep-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('cf-new-rep-btn').click();
    });
  });
}

// ═══ Drag-and-drop handlers ═══
function cfDragOver(e, key) {
  e.preventDefault();
  e.stopPropagation();
  const grid = document.getElementById('cf-grid-' + key);
  if (grid) grid.style.borderColor = 'rgba(168,85,247,0.5)';
}
function cfDragLeave(e, key) {
  e.preventDefault();
  e.stopPropagation();
  const grid = document.getElementById('cf-grid-' + key);
  if (grid) grid.style.borderColor = 'transparent';
}
async function cfDrop(e, clientName, subfolder, key) {
  e.preventDefault();
  e.stopPropagation();
  const grid = document.getElementById('cf-grid-' + key);
  if (grid) grid.style.borderColor = 'transparent';
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  // Reuse the same upload flow
  await cfUploadFiles(Array.from(files), clientName, subfolder, key);
}

// ═══ Roof type save ═══
async function cfSaveRoofTypes(clientName) {
  const checks = document.querySelectorAll('#cf-roof-types input[type=checkbox]');
  const selected = [];
  checks.forEach(c => {
    // Update visual state
    const label = c.closest('label');
    const icon = label?.querySelector('span');
    if (c.checked) {
      selected.push(c.value);
      label?.classList.add('bg-emerald-500/20', 'text-emerald-300', 'border-emerald-500/30');
      label?.classList.remove('bg-dark-800/60', 'text-dark-400', 'border-dark-600/30');
      if (icon) { icon.classList.add('bg-emerald-500', 'border-emerald-500', 'text-white'); icon.classList.remove('border-dark-500'); icon.textContent = '✓'; }
    } else {
      label?.classList.remove('bg-emerald-500/20', 'text-emerald-300', 'border-emerald-500/30');
      label?.classList.add('bg-dark-800/60', 'text-dark-400', 'border-dark-600/30');
      if (icon) { icon.classList.remove('bg-emerald-500', 'border-emerald-500', 'text-white'); icon.classList.add('border-dark-500'); icon.textContent = ''; }
    }
  });
  const val = selected.join(',');
  _cfRoofTypesCache[clientName] = val;
  await writeToSheet('saveRoofTypes', { clientName, roofTypes: val }, { silent: true });
}

// ═══ Unified upload flow (used by both file input and drag-drop) ═══
async function cfUploadFiles(fileList, clientName, subfolder, key) {
  const section = CF_SECTIONS.find(s => s.key === key);
  if (section?.noUpload) return;

  // Validate all files first
  const valid = [];
  for (const file of fileList) {
    if (!cfValidateFile(file)) continue;
    await cfCheckResolution(file);
    valid.push(file);
  }
  if (valid.length === 0) return;

  // Check section limits
  if (!cfCheckSectionLimit(key)) return;

  // For reps, show the wizard for each file
  if (key === 'reps') {
    const grid = document.getElementById('cf-grid-' + key);
    for (const file of valid) {
      const existingReps = cfGetExistingRepNames();
      const repName = await cfShowRepWizard(existingReps);
      if (!repName) { showToast('Upload cancelled', 'info'); continue; }
      const prefixedName = repName + '_' + file.name;
      if (grid) grid.innerHTML = '<div class="col-span-full text-center py-2 text-purple-400 text-xs"><div class="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin inline-block mr-2"></div>Uploading ' + file.name + '...</div>' + grid.innerHTML;
      try {
        const base64 = await fileToBase64(file);
        await writeToSheet('uploadCreativeFile', { clientName, subfolder, fileName: prefixedName, base64, mimeType: file.type });
      } catch (e) { showToast('Upload failed: ' + e.message, 'error'); }
    }
  } else {
    // Standard upload for logos/vehicles/topPerformers
    const grid = document.getElementById('cf-grid-' + key);
    if (grid) {
      const spinner = document.createElement('div');
      spinner.className = 'col-span-full text-center py-2 text-purple-400 text-xs';
      spinner.innerHTML = '<div class="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin inline-block mr-2"></div>Uploading...';
      grid.prepend(spinner);
    }
    for (const file of valid) {
      try {
        const base64 = await fileToBase64(file);
        await writeToSheet('uploadCreativeFile', { clientName, subfolder, fileName: file.name, base64, mimeType: file.type });
      } catch (e) { showToast('Upload failed: ' + e.message, 'error'); }
    }
  }

  // Invalidate cache and refresh
  delete _cfFileListCache[clientName + '|' + subfolder];
  await loadCreativeSection(clientName, subfolder, key);
  showToast(valid.length + ' file(s) uploaded', 'success');
}

async function handleCreativeUpload(event, clientName, subfolder, key) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  await cfUploadFiles(Array.from(files), clientName, subfolder, key);
  event.target.value = ''; // reset input
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove data:image/...;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function deleteCreativeFile(fileId, clientName, subfolder, key) {
  if (!confirm('Delete this file?')) return;

  const result = await writeToSheet('deleteCreativeFile', { fileId });
  if (result.ok) {
    showToast('File deleted', 'success');
    delete _cfFileListCache[clientName + '|' + subfolder];
    await loadCreativeSection(clientName, subfolder, key);
  } else {
    showToast('Delete failed: ' + (result.error || 'Unknown error'), 'error');
  }
}

async function createClientFolderAndRefresh(clientName) {
  const btn = event.target.closest('button');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2"></div>Creating...';
  }

  const result = await writeToSheet('createClientFolder', { clientName });
  if (result.ok) {
    showToast('Folder created for ' + clientName, 'success');
    await loadCreativeForgeContent(clientName);
  } else {
    showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Folder'; }
  }
}

async function saveCreativeForgeLocale(clientName) {
  const input = document.getElementById('cf-locale-input');
  if (!input) return;
  const locale = input.value.trim();
  _cfLocaleCache[clientName] = locale;

  const result = await writeToSheet('saveClientLocale', { clientName, locale });
  if (result.ok) {
    showToast('Location saved', 'success');
  } else {
    showToast('Save failed: ' + (result.error || 'Unknown error'), 'error');
  }
}

// ═══════════════════════════════════════════════
// CREATIVE FORGE QUEUE SUBMIT + STATUS
// ═══════════════════════════════════════════════

function cfToggleCustomSchedule() {
  const sel = document.getElementById('cf-gen-scene');
  const panel = document.getElementById('cf-custom-schedule');
  if (!sel || !panel) return;
  if (sel.value === 'custom') {
    panel.classList.remove('hidden');
    cfUpdateCustomTotal();
  } else {
    panel.classList.add('hidden');
  }
}

function cfUpdateCustomTotal() {
  const inputs = document.querySelectorAll('[data-cf-cat]');
  let total = 0;
  inputs.forEach(i => { total += parseInt(i.value) || 0; });
  const totalEl = document.getElementById('cf-custom-total');
  const targetEl = document.getElementById('cf-custom-target');
  const count = parseInt(document.getElementById('cf-gen-count')?.value) || 12;
  if (totalEl) {
    totalEl.textContent = total;
    totalEl.className = total === count ? 'text-emerald-400 ml-1' : (total > count ? 'text-red-400 ml-1' : 'text-yellow-400 ml-1');
  }
  if (targetEl) targetEl.textContent = count;
}

function cfBuildCustomScheduleJSON() {
  const inputs = document.querySelectorAll('[data-cf-cat]');
  const schedule = {};
  inputs.forEach(i => {
    const val = parseInt(i.value) || 0;
    if (val > 0) schedule[i.dataset.cfCat] = val;
  });
  return Object.keys(schedule).length > 0 ? JSON.stringify(schedule) : 'mixed';
}

async function submitCreativeForgeJob(clientName) {
  const count = parseInt(document.getElementById('cf-gen-count')?.value) || 12;
  const priority = document.getElementById('cf-gen-priority')?.value || 'normal';
  const sceneRaw = document.getElementById('cf-gen-scene')?.value || 'auto';
  const scene = sceneRaw === 'custom' ? cfBuildCustomScheduleJSON() : sceneRaw;
  const season = document.getElementById('cf-gen-season')?.value || 'auto';
  const notes = document.getElementById('cf-gen-notes')?.value || '';

  // Find the account's manager
  const acct = allAccounts.find(a => a.name === clientName);
  const manager = acct ? acct.manager : '';

  // Get current user
  const user = JSON.parse(localStorage.getItem('roofignite_user') || '{}');
  const requestedBy = user.name || user.email || 'Unknown';

  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding to queue...'; }

  const result = await writeToSheet('addToCreativeQueue', {
    clientName,
    requestedBy,
    imageCount: count,
    sceneOverride: scene,
    season,
    priority,
    notes,
    manager,
  });

  if (result.ok) {
    showToast(`Queued: ${count} images for ${clientName} (${priority}${season !== 'auto' ? ', ' + season : ''})`, 'success');
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Add to Queue'; }
    loadCreativeQueueStatus(clientName);
  } else {
    showToast('Queue failed: ' + (result.error || ''), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Add to Queue'; }
  }
}

async function loadCreativeQueueStatus(clientName) {
  const container = document.getElementById('cf-queue-status');
  if (!container) return;

  const result = await writeToSheet('getCreativeQueue', { clientName }, { silent: true });
  if (!result.ok || !result.jobs || result.jobs.length === 0) {
    container.innerHTML = '<h4 class="text-xs uppercase tracking-wider text-dark-400 font-semibold mb-2">Recent Jobs</h4><div class="text-xs text-dark-500">No jobs yet</div>';
    return;
  }

  const statusColors = {
    queued: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    complete: 'bg-emerald-500/20 text-emerald-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  const statusIcons = {
    queued: '⏳',
    processing: '⚡',
    complete: '✅',
    failed: '❌',
  };

  // Show last 5 jobs
  const jobs = result.jobs.slice(0, 5);

  container.innerHTML = '<h4 class="text-xs uppercase tracking-wider text-dark-400 font-semibold mb-2">Recent Jobs</h4>' +
    jobs.map(j => {
      const status = (j.Status || 'queued').toLowerCase();
      const color = statusColors[status] || statusColors.queued;
      const icon = statusIcons[status] || '⏳';
      const time = j['Requested At'] ? new Date(j['Requested At']).toLocaleString() : '';
      return `<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-800/40 mb-1.5">
        <div class="flex items-center gap-2">
          <span class="text-sm">${icon}</span>
          <div>
            <span class="text-xs text-dark-200">${j['Image Count'] || 12} images</span>
            ${j.Version ? '<span class="text-xs text-emerald-400 ml-2">' + j.Version + '</span>' : ''}
            ${j.Error ? '<span class="text-xs text-red-400 ml-2">' + j.Error.substring(0, 40) + '</span>' : ''}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-dark-500">${time}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${color}">${status}</span>
        </div>
      </div>`;
    }).join('');

  // Auto-refresh if any job is processing
  if (jobs.some(j => (j.Status || '').toLowerCase() === 'processing')) {
    setTimeout(() => loadCreativeQueueStatus(clientName), 10000);
  }
}

// ═══════════════════════════════════════════════
// IMAGE PREVIEW LIGHTBOX
// ═══════════════════════════════════════════════

function showImagePreview(url, name) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);';
  overlay.setAttribute('data-lightbox', 'true');
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="relative max-w-4xl max-h-[90vh] mx-4">
      <button onclick="this.closest('[data-lightbox]').remove()" class="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-dark-700 border border-dark-600 text-white flex items-center justify-center hover:bg-dark-600 transition-all z-10">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      <img src="${url}" alt="${name}" class="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
      <p class="text-center text-dark-300 text-sm mt-3">${name}</p>
    </div>
  `;

  // Append inside CF modal if open (same stacking context), otherwise body
  const cfModal = document.getElementById('cf-modal');
  (cfModal || document.body).appendChild(overlay);
}

// ═══════════════════════════════════════════════
// NEW CLIENT MODAL (2-step)
// ═══════════════════════════════════════════════

let _newClientStep = 1;
let _newClientName = '';

function openNewClientModal() {
  _newClientStep = 1;
  _newClientName = '';
  const managers = getManagers();

  const modal = document.createElement('div');
  modal.id = 'new-client-modal';
  modal.className = 'fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto';
  modal.style.background = 'rgba(0,0,0,0.7)';
  modal.style.backdropFilter = 'blur(4px)';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.innerHTML = `
    <div class="w-full max-w-3xl mx-4 my-8 rounded-2xl" style="background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.9));border:1px solid rgba(148,163,184,0.1);">
      <div class="flex items-center justify-between p-6 border-b border-dark-600/30">
        <div>
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <svg class="w-5 h-5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
            New Client
          </h2>
          <p class="text-dark-400 text-sm mt-1" id="ncm-step-label">Step 1 of 2 — Client Details</p>
        </div>
        <button onclick="document.getElementById('new-client-modal').remove()" class="text-dark-400 hover:text-white transition-colors p-2">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="ncm-body" class="p-6">
        ${renderNewClientStep1(managers)}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function renderNewClientStep1(managers) {
  if (!managers) managers = getManagers();
  return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Client Name *</label>
        <input id="ncm-name" type="text" placeholder="e.g. Apex Roofing" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        <div class="text-[9px] text-red-400/80 mt-1">Must match the logbook name EXACTLY</div>
      </div>
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Account Manager *</label>
        <select id="ncm-manager" onchange="ncmUpdatePod()" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500">
          ${managers.map(m => '<option value="' + m + '">' + m + '</option>').join('')}
        </select>
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Pod *</label>
        <select id="ncm-pod" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500">
          ${Object.keys(SHEETS).map(p => {
            const label = p.replace(/ - RoofIgnite/i, '');
            const autoSelected = (managerPodMap[managers[0]] === p) ? 'selected' : '';
            return '<option value="' + p + '" ' + autoSelected + '>' + label + '</option>';
          }).join('')}
        </select>
      </div>
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Meta Ad Account ID</label>
        <input id="ncm-adid" type="text" placeholder="e.g. 1234567890" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Booked Goal</label>
        <input id="ncm-booked" type="number" placeholder="6" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
      </div>
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Daily Budget ($)</label>
        <input id="ncm-daily" type="number" placeholder="50" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
        <div class="text-[9px] text-dark-500 mt-1">Monthly = daily × 28</div>
      </div>
      <div>
        <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Cycle Start Date</label>
        <input id="ncm-start" type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-4 py-2.5 focus:outline-none focus:border-brand-500" />
      </div>
    </div>
    <div class="flex justify-end gap-3">
      <button onclick="document.getElementById('new-client-modal').remove()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 border border-dark-600/30 transition-all">Cancel</button>
      <button onclick="ncmGoToStep2()" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 shadow-lg shadow-brand-500/20 transition-all">Next → Creative Forge</button>
    </div>
  `;
}

function ncmUpdatePod() {
  const mgr = document.getElementById('ncm-manager')?.value;
  const podSelect = document.getElementById('ncm-pod');
  if (podSelect && mgr && managerPodMap[mgr]) {
    const autoPod = managerPodMap[mgr];
    if (podSelect.querySelector('option[value="' + autoPod + '"]')) {
      podSelect.value = autoPod;
    }
  }
}

async function ncmGoToStep2() {
  // Validate step 1
  const name = document.getElementById('ncm-name')?.value?.trim();
  if (!name) { showToast('Please enter a client name', 'error'); return; }
  if (allAccounts.find(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast('Client already exists in the sheet', 'error'); return;
  }

  _newClientName = name;
  _newClientStep = 2;

  const stepLabel = document.getElementById('ncm-step-label');
  if (stepLabel) stepLabel.textContent = 'Step 2 of 2 — Creative Forge Setup';

  const body = document.getElementById('ncm-body');
  if (!body) return;

  body.innerHTML = `
    <div class="mb-5">
      <p class="text-dark-300 text-sm">Set up Creative Forge for <strong class="text-white">${name}</strong>. You can skip this and add later from the account page.</p>
    </div>

    <!-- Locale -->
    <div class="mb-5">
      <label class="text-[10px] uppercase tracking-wider text-dark-400 font-semibold mb-1.5 block">Client Location / Locale</label>
      <input type="text" id="ncm-locale" placeholder="e.g. Fort Lauderdale, Florida (South Florida)" class="w-full bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-dark-200 px-4 py-2.5 focus:outline-none focus:border-purple-500 transition-colors" />
    </div>

    <!-- Upload sections -->
    <div class="mb-5">
      <div class="flex items-center justify-between mb-2">
        <div><h3 class="text-sm font-semibold text-white">Approved Reps</h3><p class="text-xs text-dark-500">Photos of company representatives</p></div>
        <label class="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all cursor-pointer">
          + Upload <input type="file" accept="image/*" multiple class="hidden" onchange="ncmStageFiles(event, 'reps')" />
        </label>
      </div>
      <div id="ncm-preview-reps" class="flex flex-wrap gap-2 min-h-[40px]"><span class="text-xs text-dark-500">No files selected</span></div>
    </div>

    <div class="mb-5">
      <div class="flex items-center justify-between mb-2">
        <div><h3 class="text-sm font-semibold text-white">Approved Logos</h3><p class="text-xs text-dark-500">Company logo files</p></div>
        <label class="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all cursor-pointer">
          + Upload <input type="file" accept="image/*" multiple class="hidden" onchange="ncmStageFiles(event, 'logos')" />
        </label>
      </div>
      <div id="ncm-preview-logos" class="flex flex-wrap gap-2 min-h-[40px]"><span class="text-xs text-dark-500">No files selected</span></div>
    </div>

    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <div><h3 class="text-sm font-semibold text-white">Approved Vehicles</h3><p class="text-xs text-dark-500">Company truck/vehicle photos</p></div>
        <label class="px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all cursor-pointer">
          + Upload <input type="file" accept="image/*" multiple class="hidden" onchange="ncmStageFiles(event, 'vehicles')" />
        </label>
      </div>
      <div id="ncm-preview-vehicles" class="flex flex-wrap gap-2 min-h-[40px]"><span class="text-xs text-dark-500">No files selected</span></div>
    </div>

    <div class="flex justify-between gap-3">
      <button onclick="ncmBackToStep1()" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-300 hover:text-white bg-dark-700/50 border border-dark-600/30 transition-all">← Back</button>
      <div class="flex gap-3">
        <button onclick="ncmFinish(true)" class="px-5 py-2 rounded-xl text-sm font-medium text-dark-400 hover:text-white bg-dark-700/50 border border-dark-600/30 transition-all">Add Later</button>
        <button onclick="ncmFinish(false)" class="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 shadow-lg shadow-purple-500/20 transition-all">Create Client</button>
      </div>
    </div>
  `;
}

// Staged files for new client upload
let _ncmStagedFiles = { reps: [], logos: [], vehicles: [] };

function ncmStageFiles(event, category) {
  const files = Array.from(event.target.files || []);
  _ncmStagedFiles[category] = [..._ncmStagedFiles[category], ...files];

  const grid = document.getElementById('ncm-preview-' + category);
  if (!grid) return;

  grid.innerHTML = _ncmStagedFiles[category].map((f, i) => {
    const url = URL.createObjectURL(f);
    return '<div class="relative rounded-lg overflow-hidden border border-dark-600/30 w-20 h-20">' +
      '<img src="' + url + '" class="w-full h-full object-cover" />' +
      '<button onclick="_ncmStagedFiles.' + category + '.splice(' + i + ',1);ncmRefreshPreview(\'' + category + '\')" class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px] hover:bg-red-500">×</button>' +
      '<div class="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[7px] text-dark-200 truncate">' + f.name + '</div>' +
    '</div>';
  }).join('') || '<span class="text-xs text-dark-500">No files selected</span>';

  event.target.value = '';
}

function ncmRefreshPreview(category) {
  ncmStageFiles({ target: { files: [] } }, '___'); // dummy to not add files
  // Re-render the grid
  const grid = document.getElementById('ncm-preview-' + category);
  if (!grid) return;
  grid.innerHTML = _ncmStagedFiles[category].map((f, i) => {
    const url = URL.createObjectURL(f);
    return '<div class="relative rounded-lg overflow-hidden border border-dark-600/30 w-20 h-20">' +
      '<img src="' + url + '" class="w-full h-full object-cover" />' +
      '<button onclick="_ncmStagedFiles.' + category + '.splice(' + i + ',1);ncmRefreshPreview(\'' + category + '\')" class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px] hover:bg-red-500">×</button>' +
      '<div class="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[7px] text-dark-200 truncate">' + f.name + '</div>' +
    '</div>';
  }).join('') || '<span class="text-xs text-dark-500">No files selected</span>';
}

function ncmBackToStep1() {
  _newClientStep = 1;
  const stepLabel = document.getElementById('ncm-step-label');
  if (stepLabel) stepLabel.textContent = 'Step 1 of 2 — Client Details';
  const body = document.getElementById('ncm-body');
  if (body) body.innerHTML = renderNewClientStep1();
  // Restore name if we had it
  if (_newClientName) {
    const nameInput = document.getElementById('ncm-name');
    if (nameInput) nameInput.value = _newClientName;
  }
}

async function ncmFinish(skipCreativeForge) {
  // Read step 1 values (might be from stored state or re-read)
  const modal = document.getElementById('new-client-modal');
  const name = _newClientName;
  if (!name) { showToast('No client name', 'error'); return; }

  // Read step 1 values from the modal if we're still on step 1, otherwise use defaults
  // These were validated in ncmGoToStep2
  const mgr = document.getElementById('ncm-manager')?.value || getManagers()[0];
  const pod = document.getElementById('ncm-pod')?.value || Object.keys(SHEETS)[0];
  const adId = (document.getElementById('ncm-adid')?.value || '').trim().replace(/^act_/i, '');
  const bookedGoal = parseFloat(document.getElementById('ncm-booked')?.value) || null;
  const dailyBudget = parseFloat(document.getElementById('ncm-daily')?.value) || null;
  const startDate = document.getElementById('ncm-start')?.value || new Date().toISOString().split('T')[0];
  const endDate = new Date(new Date(startDate).getTime() + 28 * 86400000).toISOString().split('T')[0];

  // If we're on step 2, read step 1 values won't work (they're gone). Store them in step transition.
  // Actually we need to store them. Let me use the _ncmStep1Data approach.

  const locale = document.getElementById('ncm-locale')?.value?.trim() || '';

  // Show progress
  const btn = event?.target?.closest('button');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  // Create the client in the sheet
  const cycle1 = {
    account: name, adAccountId: adId, pod, manager: mgr,
    cycle: 'Cycle 1', cycleStartDate: startDate, cycleEndDate: endDate,
    bookedGoal, gregGoal: bookedGoal, cpaGoal: null, dailyBudget, monthlyBudget: dailyBudget ? dailyBudget * 28 : null,
    totalLeads: null, osaPct: null, bookedAppts: null, estBookedAppts: null,
    cpa: null, amountSpent: null, linkCTR: null, linkCPC: null,
    cpm: null, frequency: null, surveyPct: null,
    cpcMedian: null, cpcMultiplier: null,
    accountManager: mgr, notes: '', goodToBill: 'No', billed: 'No', billingNotes: ''
  };

  const newAcct = {
    name, manager: mgr, pod, adAccountId: adId, section: '',
    isPaused: false, status: 'Q1 Onboarded',
    bookedGoal, gregGoal: bookedGoal, cpaGoal: null, dailyBudget, monthlyBudget: dailyBudget ? dailyBudget * 28 : null,
    cycleStartDate: startDate, cycleEndDate: endDate,
    cycles: [cycle1]
  };

  allAccounts.push(newAcct);

  if (APPS_SCRIPT_URL) {
    const result = await writeToSheet('createClient', newAcct);
    if (result.ok) {
      showToast('Client created in sheet ✓', 'success');
    } else {
      showToast('Sheet save failed: ' + (result.error || ''), 'error');
    }

    // Create Drive folders (check for dupes)
    const checkResult = await writeToSheet('checkClientFolder', { clientName: name }, { silent: true });
    if (checkResult.ok && checkResult.exists) {
      if (confirm('A folder named "' + name + '" already exists in Master Creatives. Use the existing folder?')) {
        await writeToSheet('createClientFolder', { clientName: name }, { silent: true });
      }
    } else {
      await writeToSheet('createClientFolder', { clientName: name }, { silent: true });
      showToast('Drive folders created ✓', 'success');
    }

    // Save locale if provided
    if (!skipCreativeForge && locale) {
      await writeToSheet('saveClientLocale', { clientName: name, locale }, { silent: true });
    }

    // Upload staged files
    if (!skipCreativeForge) {
      const uploadMap = { reps: 'Approved AI References/Reps', logos: 'Approved AI References/Logos', vehicles: 'Approved AI References/Vehicles' };
      for (const [category, subfolder] of Object.entries(uploadMap)) {
        for (const file of _ncmStagedFiles[category]) {
          try {
            const base64 = await fileToBase64(file);
            await writeToSheet('uploadCreativeFile', {
              clientName: name, subfolder, fileName: file.name, base64, mimeType: file.type
            });
          } catch(e) {
            console.warn('Upload failed:', file.name, e);
          }
        }
      }
      const totalUploaded = _ncmStagedFiles.reps.length + _ncmStagedFiles.logos.length + _ncmStagedFiles.vehicles.length;
      if (totalUploaded > 0) showToast(totalUploaded + ' file(s) uploaded ✓', 'success');
    }
  }

  // Reset staged files
  _ncmStagedFiles = { reps: [], logos: [], vehicles: [] };

  // Close modal and refresh admin
  if (modal) modal.remove();
  saveDataCache();
  renderAdminView();
}

// Store step 1 data when transitioning to step 2
let _ncmStep1Data = {};
const _origNcmGoToStep2 = ncmGoToStep2;
ncmGoToStep2 = async function() {
  // Store step 1 values before they disappear
  _ncmStep1Data = {
    manager: document.getElementById('ncm-manager')?.value,
    pod: document.getElementById('ncm-pod')?.value,
    adId: document.getElementById('ncm-adid')?.value,
    bookedGoal: document.getElementById('ncm-booked')?.value,
    dailyBudget: document.getElementById('ncm-daily')?.value,
    startDate: document.getElementById('ncm-start')?.value,
  };
  await _origNcmGoToStep2();
};

// Override ncmFinish to use stored step 1 data
const _origNcmFinish = ncmFinish;
ncmFinish = async function(skipCreativeForge) {
  // Patch the DOM with stored values if we're on step 2
  if (_newClientStep === 2 && _ncmStep1Data.manager) {
    // These elements don't exist on step 2, so we inject hidden ones
    const body = document.getElementById('ncm-body');
    if (body && !document.getElementById('ncm-manager')) {
      body.insertAdjacentHTML('beforeend',
        '<input type="hidden" id="ncm-manager" value="' + (_ncmStep1Data.manager || '') + '">' +
        '<input type="hidden" id="ncm-pod" value="' + (_ncmStep1Data.pod || '') + '">' +
        '<input type="hidden" id="ncm-adid" value="' + (_ncmStep1Data.adId || '') + '">' +
        '<input type="hidden" id="ncm-booked" value="' + (_ncmStep1Data.bookedGoal || '') + '">' +
        '<input type="hidden" id="ncm-daily" value="' + (_ncmStep1Data.dailyBudget || '') + '">' +
        '<input type="hidden" id="ncm-start" value="' + (_ncmStep1Data.startDate || '') + '">'
      );
    }
  }
  await _origNcmFinish(skipCreativeForge);
};

// V2 OVERRIDES
var _origNav = typeof navigate !== 'undefined' ? navigate : function(){};
navigate = function(view, param) {
  switch(view) {
    case 'dashboard': window.location = 'dashboard.html'; break;
    case 'pod': window.location = 'dashboard.html?view=pod&param=' + encodeURIComponent(param); break;
    case 'manager': window.location = 'dashboard.html?view=manager&param=' + encodeURIComponent(param); break;
    case 'account': window.location = 'account.html?name=' + encodeURIComponent(param.name) + '&adAccountId=' + encodeURIComponent(param.adAccountId || ''); break;
    case 'billing': window.location = 'billing.html'; break;
    case 'admin': window.location = 'admin.html'; break;
    case 'donttouch': window.location = 'donttouch.html'; break;
    default: window.location = 'dashboard.html'; break;
  }
};
var _origNavAccount = typeof navigateToAccount !== 'undefined' ? navigateToAccount : function(){};
navigateToAccount = function(val) {
  if (!val) return;
  var parts = val.split('|||');
  window.location = 'account.html?name=' + encodeURIComponent(parts[0]) + '&adAccountId=' + encodeURIComponent(parts[1] || '');
};
// Auth override removed — real Google Sign-In gate is active

// Safe render wrappers — only render if the view container exists on the page
var _origRenderAdmin = renderAdminView;
renderAdminView = function() {
  if (document.getElementById('view-admin')) _origRenderAdmin();
};
var _origRenderDashboard = renderDashboard;
renderDashboard = function() {
  if (document.getElementById('view-dashboard')) _origRenderDashboard();
};
var _origRenderBilling = renderBilling;
renderBilling = function() {
  if (document.getElementById('view-billing')) _origRenderBilling();
};
var _origRenderDontTouch = renderDontTouch;
renderDontTouch = function() {
  if (document.getElementById('view-donttouch')) _origRenderDontTouch();
};

// ═══════════════════════════════════════════════
// V2: SIDEBAR FIXES
// ═══════════════════════════════════════════════

// 1. Highlight active page in sidebar based on current URL
(function highlightActivePage() {
  const page = window.location.pathname.split('/').pop() || 'dashboard.html';
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const param = params.get('param');

  // Remove all existing active classes
  document.querySelectorAll('.nav-item.active').forEach(el => el.classList.remove('active'));

  // Set active based on current page
  if (page === 'dashboard.html' && !view) {
    document.getElementById('nav-dashboard')?.classList.add('active');
  } else if (page === 'dashboard.html' && view === 'manager' && param) {
    const key = param.toLowerCase().replace(/\s+/g, '-');
    document.getElementById('nav-mgr-' + key)?.classList.add('active');
  } else if (page === 'dashboard.html' && view === 'pod' && param) {
    const podId = 'nav-pod-' + param.replace(/\s+/g, '-');
    document.getElementById(podId)?.classList.add('active');
  } else if (page === 'billing.html') {
    document.getElementById('nav-billing')?.classList.add('active');
  } else if (page === 'admin.html') {
    document.getElementById('nav-admin')?.classList.add('active');
  } else if (page === 'donttouch.html') {
    document.getElementById('nav-donttouch')?.classList.add('active');
  }
})();

// 2. Re-highlight after sidebar managers/pods are rendered (they get rebuilt by loadAllData)
var _origRenderSidebarManagers = renderSidebarManagers;
renderSidebarManagers = function() {
  _origRenderSidebarManagers();
  // Re-apply active highlight for manager pages
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'manager' && params.get('param')) {
    const key = params.get('param').toLowerCase().replace(/\s+/g, '-');
    document.getElementById('nav-mgr-' + key)?.classList.add('active');
  }
};
var _origRenderSidebarPods = renderSidebarPods;
renderSidebarPods = function() {
  _origRenderSidebarPods();
  // Re-apply active highlight for pod pages
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'pod' && params.get('param')) {
    const podId = 'nav-pod-' + params.get('param').replace(/\s+/g, '-');
    document.getElementById(podId)?.classList.add('active');
  }
};

// Sidebar collapse removed — sidebar is always visible on desktop
