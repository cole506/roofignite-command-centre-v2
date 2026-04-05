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
        <div class="w-6 h-6 rounded-full bg-gradient-to-br from-${c.from}/20 to-${c.to}/20 flex items-center justify-center text-[10px] font-bold text-${c.text} border border-${c.border}/20">${initial}</div>
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
        <button onclick="adminShowNewClient=true;renderAdminView()" class="flex items-center gap-1.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold hover:from-brand-600 hover:to-brand-700 transition-all shadow-lg shadow-brand-500/20">
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
      <button onclick="adminTab='settings';Promise.all([loadSlackConfig(),loadCreativeForgeAutoConfig()]).then(()=>renderAdminView())" class="px-5 py-2 rounded-xl text-xs font-semibold transition-all ${adminTab === 'settings' ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-transparent text-dark-400 border border-transparent hover:text-white'}">
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

    <!-- Creative Forge Auto-Restock -->
    <div class="glass rounded-2xl p-6 mb-6">
      <div class="flex items-center gap-3 mb-2">
        <span class="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-600/20 border border-purple-500/20 flex items-center justify-center text-sm">🔄</span>
        <div>
          <h3 class="text-base font-bold text-white">Creative Forge Auto-Restock</h3>
          <p class="text-dark-400 text-xs mt-0.5">Automatically queue creative generation for all active clients on a weekly schedule. Requires a time-driven trigger in Apps Script.</p>
        </div>
      </div>

      <div class="space-y-4 mt-4">
        <div class="flex items-center gap-4">
          <label class="text-sm text-dark-300 min-w-[100px]">Enabled</label>
          <button id="cf-auto-toggle"
            onclick="toggleCreativeForgeAuto()"
            class="relative w-12 h-6 rounded-full transition-colors duration-200 ${window._cfAutoEnabled ? 'bg-green-500' : 'bg-dark-600'} cursor-pointer">
            <span class="absolute top-0.5 ${window._cfAutoEnabled ? 'left-6' : 'left-0.5'} w-5 h-5 bg-white rounded-full shadow transition-all duration-200"></span>
          </button>
          <span id="cf-auto-status" class="text-xs font-medium ${window._cfAutoEnabled ? 'text-green-400' : 'text-dark-500'}">${window._cfAutoEnabled ? 'On' : 'Off'}</span>
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm text-dark-300 min-w-[100px]">Batch Size</label>
          <input id="cf-auto-batch" type="number" min="1" max="50" value="${window._cfAutoBatchSize || 20}"
            class="w-24 bg-dark-800/80 border border-dark-600/50 rounded-xl text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500" />
          <button onclick="saveCreativeForgeAutoConfig()"
            class="px-4 py-2 rounded-xl text-xs font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30 hover:bg-brand-500/30 transition-all">Save</button>
        </div>

        <div class="flex items-center gap-3 mt-2">
          <button onclick="runWeeklyRestock()"
            class="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-all">Run Now (Manual Trigger)</button>
          <span id="cf-restock-status" class="text-xs text-dark-400"></span>
        </div>
      </div>

      <p class="text-[10px] text-dark-500 mt-3">Jobs are queued with <span class="text-purple-400">auto</span> priority (processed after all manual Rush and Standard jobs). Set up a weekly time-driven trigger on <code class="text-dark-400">scheduleWeeklyCreatives</code> in Apps Script.</p>
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

// ═══ Creative Forge Auto-Restock Helpers ═══

window._cfAutoEnabled = false;
window._cfAutoBatchSize = 20;

async function loadCreativeForgeAutoConfig() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const result = await writeToSheet('getCreativeForgeAutoConfig', {});
    if (result.ok) {
      window._cfAutoEnabled = !!result.enabled;
      window._cfAutoBatchSize = result.batchSize || 20;
    }
  } catch (e) {
    console.error('Failed to load Creative Forge auto config:', e);
  }
}

async function toggleCreativeForgeAuto() {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  window._cfAutoEnabled = !window._cfAutoEnabled;
  const batch = parseInt(document.getElementById('cf-auto-batch')?.value) || window._cfAutoBatchSize;
  const result = await writeToSheet('saveCreativeForgeAutoConfig', { enabled: window._cfAutoEnabled, batchSize: batch });
  if (result.ok) {
    showToast(`Auto-restock ${window._cfAutoEnabled ? 'enabled' : 'disabled'}`, 'success');
    renderAdminView();
  } else {
    window._cfAutoEnabled = !window._cfAutoEnabled;
    showToast('Failed to save config', 'error');
  }
}

async function saveCreativeForgeAutoConfig() {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  const batch = parseInt(document.getElementById('cf-auto-batch')?.value) || 20;
  window._cfAutoBatchSize = batch;
  const result = await writeToSheet('saveCreativeForgeAutoConfig', { enabled: window._cfAutoEnabled, batchSize: batch });
  if (result.ok) {
    showToast(`Batch size saved: ${batch} images`, 'success');
  } else {
    showToast('Failed to save config', 'error');
  }
}

async function runWeeklyRestock() {
  if (!APPS_SCRIPT_URL) { showToast('Connect Apps Script first', 'error'); return; }
  const statusEl = document.getElementById('cf-restock-status');
  if (statusEl) statusEl.textContent = 'Queuing clients...';
  showToast('Running weekly restock...', 'success');
  try {
    const result = await writeToSheet('scheduleWeeklyCreatives', {});
    if (result.ok) {
      if (result.skipped) {
        showToast(result.reason || 'Auto-restock is disabled', 'error');
        if (statusEl) statusEl.textContent = result.reason || 'Disabled';
      } else {
        showToast(`Queued ${result.queued} client(s)`, 'success');
        if (statusEl) statusEl.textContent = `✅ ${result.queued} client(s) queued`;
      }
    } else {
      showToast('Failed: ' + (result.error || 'unknown'), 'error');
      if (statusEl) statusEl.textContent = '❌ ' + (result.error || 'Failed');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = '❌ ' + e.message;
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

  // Re-render to show changes
  navigate('account', { name: accountName, adAccountId: acct.adAccountId });

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

  navigate('account', { name: accountName, adAccountId: acct.adAccountId });

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

  navigate('account', { name: accountName, adAccountId: acct.adAccountId });

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
  if (currentView === 'account') {
    renderAccountDetail(accountName);
  } else {
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
