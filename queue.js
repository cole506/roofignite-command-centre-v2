/**
 * Creative Forge Queue Tracker
 * Dominos Pizza Tracker-style UI for monitoring creative generation jobs.
 */

let _queuePollTimer = null;
let _queueShowCompleted = 10;

const QUEUE_STAGES = [
  { key: 'queued',     label: 'Queued',     icon: '⏳' },
  { key: 'generating', label: 'Generating', icon: '🎨' },
  { key: 'qa',         label: 'QA',         icon: '🔍' },
  { key: 'complete',   label: 'Done',       icon: '✅' },
];

const QUEUE_STATUS_INDEX = {
  queued: 0,
  generating: 1,
  processing: 1, // backward compat
  qa: 2,
  complete: 3,
  failed: -1,
};

const QUEUE_PRIORITY_BADGE = {
  rush:   '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">RUSH</span>',
  normal: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">Standard</span>',
  auto:   '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">Auto</span>',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function buildTrackerBar(status) {
  const statusLower = (status || 'queued').toLowerCase();
  const isFailed = statusLower === 'failed';
  const currentIdx = isFailed ? 1 : (QUEUE_STATUS_INDEX[statusLower] ?? 0);

  // For failed: show red at the stage it failed at (assume generating if we don't know)
  let failIdx = currentIdx;

  let html = '<div class="flex items-center gap-0 w-full mt-4 mb-2 px-2">';

  for (let i = 0; i < QUEUE_STAGES.length; i++) {
    const stage = QUEUE_STAGES[i];
    const isPast = !isFailed && i < currentIdx;
    const isActive = !isFailed && i === currentIdx;
    const isFuture = !isFailed && i > currentIdx;
    const isFailPoint = isFailed && i === failIdx;
    const isFailPast = isFailed && i < failIdx;
    const isFailFuture = isFailed && i > failIdx;

    // Circle
    if (isPast || isFailPast) {
      // Completed stage — filled gold circle with check
      html += `<div class="flex flex-col items-center flex-shrink-0" style="width:48px">
        <div class="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
          <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
        </div>
        <span class="text-[9px] text-brand-400 font-semibold mt-1.5">${stage.label}</span>
      </div>`;
    } else if (isActive) {
      // Active stage — pulsing gold ring
      html += `<div class="flex flex-col items-center flex-shrink-0" style="width:48px">
        <div class="w-8 h-8 rounded-full border-2 border-brand-500 flex items-center justify-center tracker-pulse shadow-lg shadow-brand-500/20">
          <span class="text-xs font-bold text-brand-400">${stage.icon}</span>
        </div>
        <span class="text-[9px] text-brand-400 font-semibold mt-1.5">${stage.label}</span>
      </div>`;
    } else if (isFailPoint) {
      // Failed at this stage — red ring
      html += `<div class="flex flex-col items-center flex-shrink-0" style="width:48px">
        <div class="w-8 h-8 rounded-full border-2 border-red-500 flex items-center justify-center shadow-lg shadow-red-500/20">
          <span class="text-xs font-bold text-red-400">✕</span>
        </div>
        <span class="text-[9px] text-red-400 font-semibold mt-1.5">Failed</span>
      </div>`;
    } else {
      // Future/unreached stage — grey circle
      html += `<div class="flex flex-col items-center flex-shrink-0" style="width:48px">
        <div class="w-8 h-8 rounded-full border-2 border-dark-600 flex items-center justify-center">
          <span class="text-[10px] text-dark-500">${i + 1}</span>
        </div>
        <span class="text-[9px] text-dark-500 mt-1.5">${stage.label}</span>
      </div>`;
    }

    // Connector bar (between circles, not after last)
    if (i < QUEUE_STAGES.length - 1) {
      const nextFilled = !isFailed && (i + 1) <= currentIdx;
      const nextFailFilled = isFailed && (i + 1) <= failIdx;
      const filled = nextFilled || nextFailFilled;
      const barColor = isFailed && (i + 1) === failIdx ? 'bg-red-500' : filled ? 'bg-brand-500' : 'bg-dark-600';

      html += `<div class="flex-1 h-0.5 ${barColor} rounded-full transition-all duration-1000"></div>`;
    }
  }

  html += '</div>';
  return html;
}

function buildStatusText(job) {
  const status = (job.Status || 'queued').toLowerCase();
  switch (status) {
    case 'queued': return '<span class="text-yellow-400">⏳ Waiting in queue...</span>';
    case 'generating':
    case 'processing': return '<span class="text-indigo-400">🎨 Generating images...</span>';
    case 'qa': return '<span class="text-cyan-400">🔍 Running QA validation...</span>';
    case 'complete': return `<span class="text-emerald-400">✅ Complete — ${job.Version || ''}, ${job['Image Count'] || '?'} images</span>`;
    case 'failed': return `<span class="text-red-400">❌ Failed — ${job.Error || 'Unknown error'}</span>`;
    default: return `<span class="text-dark-400">${status}</span>`;
  }
}

function buildJobCard(job, isCompleted) {
  const status = (job.Status || 'queued').toLowerCase();
  const priority = (job.Priority || 'normal').toLowerCase();
  const clientName = job['Client Name'] || 'Unknown';
  const imageCount = job['Image Count'] || '?';
  const requestedBy = job['Requested By'] || '';
  const manager = job.Manager || '';
  const requestedAt = job['Requested At'] || '';
  const completedAt = job['Completed At'] || '';
  const isFailed = status === 'failed';

  const opacity = isCompleted && !isFailed ? 'opacity-50' : '';
  const borderClass = isFailed ? 'border-l-4 border-l-red-500' : '';

  return `
    <div class="glass rounded-2xl p-5 ${opacity} ${borderClass} transition-all duration-500">
      <!-- Header -->
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2.5">
          <h3 class="text-sm font-bold text-white">${clientName}</h3>
          ${QUEUE_PRIORITY_BADGE[priority] || ''}
        </div>
        <span class="text-[10px] text-dark-400">${timeAgo(isCompleted ? completedAt : requestedAt)}</span>
      </div>

      <!-- Info row -->
      <div class="flex items-center gap-3 text-[10px] text-dark-400 mb-1">
        <span>${imageCount} images</span>
        ${requestedBy ? `<span>· ${requestedBy}</span>` : ''}
        ${manager ? `<span>· ${manager}</span>` : ''}
        ${isCompleted && job.Version ? `<span>· <span class="text-brand-400 font-semibold">${job.Version}</span></span>` : ''}
      </div>

      <!-- Tracker bar -->
      ${isCompleted && !isFailed ? buildCompletedBar() : buildTrackerBar(status)}

      <!-- Status text -->
      <div class="text-xs mt-2 px-2">${buildStatusText(job)}</div>
    </div>
  `;
}

function buildCompletedBar() {
  let html = '<div class="flex items-center gap-0 w-full mt-4 mb-2 px-2">';
  for (let i = 0; i < QUEUE_STAGES.length; i++) {
    html += `<div class="flex flex-col items-center flex-shrink-0" style="width:48px">
      <div class="w-8 h-8 rounded-full bg-dark-600 flex items-center justify-center">
        <svg class="w-4 h-4 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
      </div>
      <span class="text-[9px] text-dark-500 mt-1.5">${QUEUE_STAGES[i].label}</span>
    </div>`;
    if (i < QUEUE_STAGES.length - 1) {
      html += `<div class="flex-1 h-0.5 bg-dark-600 rounded-full"></div>`;
    }
  }
  html += '</div>';
  return html;
}

function renderQueueCards(jobs) {
  const el = document.getElementById('view-queue');
  if (!el) return;

  const activeStatuses = ['queued', 'generating', 'processing', 'qa'];
  const active = jobs.filter(j => activeStatuses.includes((j.Status || '').toLowerCase()));
  const completed = jobs.filter(j => !activeStatuses.includes((j.Status || '').toLowerCase()));

  // Sort active: rush first, then normal, then auto. Within priority: oldest first
  const priorityOrder = { rush: 0, normal: 1, auto: 2 };
  active.sort((a, b) => {
    const pa = priorityOrder[(a.Priority || 'normal').toLowerCase()] ?? 1;
    const pb = priorityOrder[(b.Priority || 'normal').toLowerCase()] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(a['Requested At'] || 0) - new Date(b['Requested At'] || 0);
  });

  // Sort completed: most recent first
  completed.sort((a, b) => new Date(b['Completed At'] || 0) - new Date(a['Completed At'] || 0));

  const hasActive = active.length > 0;
  const visibleCompleted = completed.slice(0, _queueShowCompleted);
  const hasMore = completed.length > _queueShowCompleted;

  let html = `
    <div class="max-w-3xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-extrabold text-white tracking-tight">Creative Forge Queue</h1>
          <p class="text-dark-400 text-xs mt-1">Real-time creative generation tracker</p>
        </div>
        <div class="flex items-center gap-2">
          ${hasActive ? '<div class="w-2 h-2 rounded-full bg-green-500 pulse"></div><span class="text-[10px] text-green-400 font-medium">Live</span>' : '<span class="text-[10px] text-dark-500">Idle</span>'}
        </div>
      </div>

      <!-- Active Jobs -->
      <div class="mb-8">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-[10px] uppercase tracking-[0.15em] text-dark-400 font-semibold">Active Jobs</span>
          <span class="text-[10px] text-dark-500">(${active.length})</span>
        </div>
        ${active.length === 0
          ? '<div class="glass rounded-2xl p-8 text-center"><p class="text-dark-400 text-sm">No active jobs. Queue is empty.</p></div>'
          : `<div class="space-y-3">${active.map(j => buildJobCard(j, false)).join('')}</div>`
        }
      </div>

      <!-- Completed Jobs -->
      <div>
        <div class="flex items-center gap-2 mb-3">
          <span class="text-[10px] uppercase tracking-[0.15em] text-dark-400 font-semibold">Completed</span>
          <span class="text-[10px] text-dark-500">(${completed.length})</span>
        </div>
        ${visibleCompleted.length === 0
          ? '<div class="glass rounded-2xl p-8 text-center"><p class="text-dark-400 text-sm">No completed jobs yet.</p></div>'
          : `<div class="space-y-3">
              ${visibleCompleted.map(j => buildJobCard(j, true)).join('')}
              ${hasMore ? `<button onclick="_queueShowCompleted+=10;refreshQueueData()" class="w-full py-3 text-center text-xs text-dark-400 hover:text-white transition-all glass rounded-xl">Show more (${completed.length - _queueShowCompleted} remaining)</button>` : ''}
            </div>`
        }
      </div>
    </div>
  `;

  el.innerHTML = html;
}

async function refreshQueueData() {
  try {
    const result = await writeToSheet('getCreativeQueue', {}, { silent: true });
    if (!result.ok) return;
    renderQueueCards(result.jobs || []);
    scheduleQueuePoll(result.jobs || []);
  } catch (e) {
    console.error('Queue refresh error:', e);
  }
}

function scheduleQueuePoll(jobs) {
  if (_queuePollTimer) clearTimeout(_queuePollTimer);
  const activeStatuses = ['queued', 'generating', 'processing', 'qa'];
  const hasActive = jobs.some(j => activeStatuses.includes((j.Status || '').toLowerCase()));
  const interval = hasActive ? 5000 : 30000;
  _queuePollTimer = setTimeout(refreshQueueData, interval);
}

function renderQueueTracker() {
  const el = document.getElementById('view-queue');
  if (!el) return;
  el.classList.remove('hidden');

  // Show loading skeleton
  el.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-xl font-extrabold text-white tracking-tight">Creative Forge Queue</h1>
          <p class="text-dark-400 text-xs mt-1">Loading queue data...</p>
        </div>
      </div>
      <div class="glass rounded-2xl p-8 text-center">
        <div class="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-dark-400 text-sm">Fetching queue status...</p>
      </div>
    </div>
  `;

  refreshQueueData();
}
