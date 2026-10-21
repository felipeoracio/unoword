let securityMode = null;
let securityOwner = null;
let securityBusy = false;
function clearSecurityForms() {
  securityMode = null; securityOwner = null;
  $('security-form').reset(); $('security-form').hidden = true; $('security-status').textContent = '';
  for (const id of ['security-current-password','security-new-password','security-confirm-password']) $(id).type = 'password';
}
function securityMessage(code) {
  const known = ['account_changed','current_password_invalid','identity_provider_required','security_rate_limited','email_unavailable','password_policy_rejected','verification_expired','email_unchanged','no_pending_email','email_workflow_not_configured','email_verification_not_configured','session_expired'];
  return t('security.' + (known.includes(code) ? code : 'failed'));
}
async function loadAccountSecurity() {
  $('account-security').hidden = !account.authenticated;
  $('security-email').textContent = account.email || '';
  if (!account.authenticated) return;
  const owner = account.userId;
  const response = await sendMessage({ type: 'ACCOUNT_SECURITY', action: 'status' });
  if (owner !== account.userId) return;
  if (!response.ok) { $('security-status').textContent = securityMessage(response.error); return; }
  const data = response.result;
  $('security-email').textContent = data.email || '';
  $('security-verified').textContent = t(data.email_verified ? 'security.verified' : 'security.unverified');
  $('security-provider-note').hidden = data.password_identity;
  $('security-change-email').disabled = !data.password_identity;
  $('security-change-password').disabled = !data.password_identity;
  $('security-resend').hidden = !data.pending_email;
  if (data.pending_email) $('security-status').textContent = t('security.pending', { email: data.pending_email });
}
function openSecurityForm(mode) {
  clearSecurityForms(); securityMode = mode; securityOwner = account.userId;
  $('security-form').hidden = false; $('security-email-field').hidden = mode !== 'email';
  $('security-new-email').required = mode === 'email';
  $('security-new-password-fields').hidden = mode !== 'password';
  $('security-new-password').required = mode === 'password'; $('security-confirm-password').required = mode === 'password';
  $('security-current-password').focus();
}
async function submitSecurity(action) {
  if (securityBusy || !securityOwner || securityOwner !== account.userId) return;
  const owner = securityOwner;
  const body = { current_password: $('security-current-password').value };
  if (action === 'email') body.email = $('security-new-email').value.trim();
  if (action === 'password') {
    body.new_password = $('security-new-password').value; body.confirm_password = $('security-confirm-password').value;
    if (body.new_password !== body.confirm_password) { $('security-status').textContent = t('security.mismatch'); return; }
  }
  securityBusy = true; $('security-submit').disabled = true; $('security-resend').disabled = true;
  try {
    const result = await sendMessage({ type: 'ACCOUNT_SECURITY', action, expectedUserId: owner, body });
    if (owner !== account.userId) return;
    if (!result.ok) { $('security-status').textContent = securityMessage(result.error); return; }
    clearSecurityForms(); await loadAccountSecurity();
    $('security-status').textContent = t(action === 'password' ? (result.result.other_sessions_revoked ? 'security.passwordSaved' : 'security.revocationFailed') : 'security.emailSent');
  } finally {
    $('security-current-password').value = ''; $('security-new-password').value = ''; $('security-confirm-password').value = '';
    securityBusy = false; $('security-submit').disabled = false; $('security-resend').disabled = false;
  }
}
function setupAccountSecurity() {
  $('security-change-email').onclick = () => openSecurityForm('email');
  $('security-change-password').onclick = () => openSecurityForm('password');
  $('security-cancel').onclick = clearSecurityForms;
  $('security-form').onsubmit = event => { event.preventDefault(); submitSecurity(securityMode); };
  $('security-resend').onclick = () => submitSecurity('resend');
  $('security-show-password').onchange = event => {
    for (const id of ['security-current-password','security-new-password','security-confirm-password']) $(id).type = event.target.checked ? 'text' : 'password';
  };
  $('forgot-password').onclick = async () => {
    if (securityBusy) return;
    const email = (account.authenticated ? account.email : els.accountEmail.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { els.accountEditor.hidden = false; els.accountEmail.focus(); $('security-status').textContent = t('security.enterEmail'); return; }
    securityBusy = true; $('forgot-password').disabled = true;
    try {
      const response = await sendMessage({ type: 'ACCOUNT_SECURITY', action: 'recovery', body: { email } });
      $('security-status').textContent = response.ok ? t('security.recoverySent') : securityMessage(response.error);
    } finally { securityBusy = false; $('forgot-password').disabled = false; }
  };
}
