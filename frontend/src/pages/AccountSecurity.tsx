import { useEffect, useState } from 'react';

// Keep one-use verification tokens in memory only, and remove them before any
// UI or network call. Never persist tokens in browser storage or analytics.
const incoming = new URLSearchParams(window.location.search);
const tokenHash = incoming.get('token_hash') || '';
const kind = incoming.get('type');
const hadFragment = !!window.location.hash;
if (window.location.pathname === '/account/security') window.history.replaceState({}, '', '/account/security');

export default function AccountSecurity() {
  const [unexpectedFragment, setUnexpectedFragment] = useState(hadFragment);
  useEffect(() => {
    const scrub = () => {
      if (window.location.hash) { window.history.replaceState({}, '', '/account/security'); setUnexpectedFragment(true); }
    };
    window.addEventListener('hashchange', scrub);
    return () => window.removeEventListener('hashchange', scrub);
  }, []);
  const [spanish, setSpanish] = useState(navigator.language.startsWith('es'));
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const text = (en: string, es: string) => spanish ? es : en;
  const recovery = kind === 'recovery';
  const usable = !unexpectedFragment && !!tokenHash && (recovery || kind === 'email_change');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || done || !usable) return;
    if (recovery && password !== confirmation) { setMessage(text('Passwords must match.', 'Las contraseñas deben coincidir.')); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(recovery ? '/api/auth/recovery/complete' : '/api/auth/email/verify', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recovery ? { token_hash: tokenHash, new_password: password, confirm_password: confirmation } : { token_hash: tokenHash, type: 'email_change' }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.detail === 'password_policy_rejected'
          ? text('Password rejected by the provider. Choose a stronger password and request a new reset link.', 'El proveedor rechazó la contraseña. Elige otra más segura y solicita un enlace nuevo.')
          : text('This request failed. The link may be expired or already used. Request a new link in Uno Word.', 'La solicitud falló. El enlace puede haber caducado o haberse usado. Solicita otro en Uno Word.'));
        return;
      }
      setDone(true);
      setMessage(recovery
        ? text(data.other_sessions_revoked ? 'Password updated. Reopen Uno Word and sign in with your new password.' : 'Password updated, but other sessions could not be revoked. Sign out of your other devices.', data.other_sessions_revoked ? 'Contraseña actualizada. Abre Uno Word e inicia sesión con tu nueva contraseña.' : 'Contraseña actualizada, pero no se revocaron las demás sesiones. Cierra sesión en los otros dispositivos.')
        : text('Verification accepted. Check both your old and new inboxes to finish secure email change, then reopen Uno Word.', 'Verificación aceptada. Revisa ambas bandejas para completar el cambio seguro y vuelve a abrir Uno Word.'));
    } catch { setMessage(text('Connection failed. Please try again.', 'La conexión falló. Inténtalo de nuevo.')); }
    finally { setPassword(''); setConfirmation(''); setBusy(false); }
  }
  return <main style={{ maxWidth: 480, margin: '8vh auto', padding: 24, overflowWrap: 'anywhere' }}>
    <button onClick={() => setSpanish(!spanish)} style={{ float: 'right' }}>{spanish ? 'English' : 'Español'}</button>
    <h1>Uno Word</h1><h2>{text('Account & Security', 'Cuenta y seguridad')}</h2>
    {!usable && <p>{text(unexpectedFragment ? 'This link uses an unsupported format. Ask the administrator to configure secure email templates, then request a new link.' : 'Open the secure link from your Uno Word verification email.', unexpectedFragment ? 'El enlace usa un formato no compatible. Pide al administrador que configure las plantillas seguras y solicita otro enlace.' : 'Abre el enlace seguro del correo de Uno Word.')}</p>}
    {usable && !done && <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      {recovery && <><label>{text('New password', 'Nueva contraseña')}<input style={{ display: 'block', width: '100%', padding: 12 }} type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={200} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label>{text('Confirm new password', 'Confirmar contraseña')}<input style={{ display: 'block', width: '100%', padding: 12 }} type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={200} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      <label><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> {text('Show passwords', 'Mostrar contraseñas')}</label></>}
      <button disabled={busy} type="submit" style={{ background: '#0866ff', color: 'white', borderRadius: 12, padding: 14 }}>{busy ? text('Please wait…', 'Espera…') : text(recovery ? 'Update password' : 'Verify email', recovery ? 'Actualizar contraseña' : 'Verificar correo')}</button>
    </form>}
    <p role="status">{message}</p>
  </main>;
}
