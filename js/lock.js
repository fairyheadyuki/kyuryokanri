// 起動パスコード。覗き見防止のためのもので、データは暗号化しない。
import { db, wipeAll } from './db.js';
import { confirmDialog, h } from './util.js';

const RELOCK_AFTER_MS = 60 * 1000;

async function hash(code, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function setPasscode(code) {
  const salt = crypto.randomUUID();
  await db.settings.set('passcode', { salt, hash: await hash(code, salt) });
}

export const clearPasscode = () => db.settings.del('passcode');
export const hasPasscode = async () => Boolean(await db.settings.get('passcode'));

let lockEl = null;

async function showLock() {
  const saved = await db.settings.get('passcode');
  if (!saved || lockEl) return;
  const error = h('p', { class: 'error', role: 'alert' });
  const input = h('input', {
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-label': 'パスコード',
    onKeydown: (e) => { if (e.key === 'Enter') submit(); },
  });
  const submit = async () => {
    if (await hash(input.value, saved.salt) === saved.hash) {
      lockEl.remove();
      lockEl = null;
    } else {
      error.textContent = 'パスコードが違います';
      input.value = '';
    }
  };
  const reset = async () => {
    const ok = await confirmDialog({
      title: 'すべて消去しますか?',
      body: '明細、画像、API キー、設定をすべて消去して初期状態に戻します。バックアップがなければ元に戻せません。',
      ok: 'すべて消去',
      danger: true,
    });
    if (!ok) return;
    await wipeAll();
    location.reload();
  };
  lockEl = h('div', { class: 'lock' },
    h('h1', {}, 'パスコードを入力'),
    input,
    error,
    h('button', { class: 'btn btn-primary', type: 'button', onClick: submit }, '開く'),
    h('button', { class: 'btn btn-ghost small', type: 'button', onClick: reset }, 'パスコードを忘れた場合'),
  );
  document.body.append(lockEl);
  input.focus();
}

export async function initLock() {
  await showLock();
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) showLock();
  });
}
