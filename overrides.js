
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
var _origCheck = typeof checkExistingSession !== 'undefined' ? checkExistingSession : function(){};
checkExistingSession = function() {
  var lg = document.getElementById('login-gate'); if(lg) lg.classList.add('hidden');
  var ap = document.getElementById('app'); if(ap) ap.classList.remove('hidden');
  return true;
};
