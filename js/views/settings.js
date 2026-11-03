import { createBackupFile, createCsvFile, restoreBackup } from '../backup.js';
import { testApiKey } from '../claude.js';
import { db } from '../db.js';
import { getSettings } from '../domain.js';
import { clearPasscode, hasPasscode, setPasscode } from '../lock.js';
import { go, topbar } from '../router.js';
import { confirmDialog, h, shareOrDownload, toast } from '../util.js';

function apiKeySection(saved) {
  const status = h('p', { class: 'setting-note', role: 'status' }, saved ? 'キーは設定済みです。' : 'キーは未設定です。');
  const input = h('input', { type: 'password', autocomplete: 'off', placeholder: saved ? '設定済み(変更するときだけ入力)' : 'sk-ant-...', 'aria-label': 'API キー' });

  const test = async (key) => {
    status.textContent = '確認しています…';
    try {
      await testApiKey(key);
      status.textContent = 'キーを確認できました。';
    } catch (err) {
      status.textContent = err.message;
    }
  };

  return h('section', { class: 'card stack' },
    h('h2', {}, 'Claude API キー'),
    input,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
        const key = input.value.trim();
        if (!key) return;
        await db.settings.set('apiKey', key);
        input.value = '';
        input.placeholder = '設定済み(変更するときだけ入力)';
        toast('保存しました');
        await test(key);
      } }, '保存'),
      h('button', { class: 'btn', type: 'button', onClick: async () => {
        const key = input.value.trim() || await db.settings.get('apiKey');
        if (key) await test(key);
        else status.textContent = 'キーを入力してください。';
      } }, '確認'),
      h('button', { class: 'btn btn-danger-text', type: 'button', onClick: async () => {
        await db.settings.del('apiKey');
        input.placeholder = 'sk-ant-...';
        status.textContent = 'キーを削除しました。';
      } }, '削除'),
    ),
    status,
    h('p', { class: 'setting-note' }, 'キーはこの端末内だけに保存します。このアプリ専用のキーを発行し、Claude Console で利用上限を設定して使ってください。'),
  );
}

function yearSection(startMonth) {
  return h('section', { class: 'card stack' },
    h('h2', {}, '年の区切り'),
    h('label', {}, '年の開始月',
      h('select', { onChange: async (e) => {
        await db.settings.set('startMonth', Number(e.target.value));
        toast('変更しました');
      } }, Array.from({ length: 12 }, (_, i) => i + 1).map((m) =>
        h('option', { value: m, selected: m === startMonth }, `${m}月`)))),
    h('p', { class: 'setting-note' }, '1月にすると源泉徴収票の集計と揃います。'),
  );
}

function passcodeSection(enabled) {
  const code = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: '4桁以上の数字', 'aria-label': '新しいパスコード' });
  return h('section', { class: 'card stack' },
    h('h2', {}, '起動パスコード'),
    h('p', { class: 'setting-note' }, enabled ? 'パスコードを設定しています。' : 'パスコードは未設定です。'),
    code,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: async () => {
        if (!/^\d{4,}$/.test(code.value)) { toast('4桁以上の数字で入力してください'); return; }
        await setPasscode(code.value);
        toast('設定しました');
        go('settings');
      } }, enabled ? '変更' : '設定'),
      enabled && h('button', { class: 'btn btn-danger-text', type: 'button', onClick: async () => {
        const ok = await confirmDialog({ title: 'パスコードを解除しますか?', ok: '解除', danger: true });
        if (!ok) return;
        await clearPasscode();
        toast('解除しました');
        go('settings');
      } }, '解除'),
    ),
    h('p', { class: 'setting-note' }, '覗き見を防ぐためのもので、データの暗号化ではありません。忘れた場合はデータをすべて消去して初期化するしかないので、バックアップを取っておいてください。'),
  );
}

function backupSection(lastBackupAt) {
  const lastLine = h('p', { class: 'setting-note' }, lastBackupAt
    ? `前回のバックアップ: ${new Date(lastBackupAt).toLocaleString('ja-JP')}`
    : 'まだバックアップしていません。');
  const actions = h('div', { class: 'stack' });

  // iOS の共有シートはタップ直後にしか開けないので、作成と保存を2段階に分ける
  const prepare = (label, create, onSaved) => async () => {
    actions.replaceChildren(h('p', { class: 'setting-note' }, '作成しています…'));
    const file = await create();
    actions.replaceChildren(
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: async () => {
        if (await shareOrDownload(file)) await onSaved?.();
        renderActions();
      } }, `${label}を保存(${Math.ceil(file.size / 1024).toLocaleString('ja-JP')}KB)`),
    );
  };

  const fileInput = h('input', { class: 'visually-hidden', type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true', onChange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmDialog({
      title: 'バックアップを読み込みますか?',
      body: '同じ明細は上書きし、それ以外の明細は残します。',
      ok: '読み込む',
    });
    if (!ok) return;
    try {
      const count = await restoreBackup(file);
      toast(`${count}件の明細を読み込みました`);
      go('settings');
    } catch (err) {
      toast(err.message);
    }
  } });

  const renderActions = () => actions.replaceChildren(
    h('button', { class: 'btn btn-block', type: 'button', onClick: prepare('バックアップ', createBackupFile, async () => {
      const now = new Date().toISOString();
      await db.settings.set('lastBackupAt', now);
      lastLine.textContent = `前回のバックアップ: ${new Date(now).toLocaleString('ja-JP')}`;
    }) }, 'バックアップを作成'),
    h('button', { class: 'btn btn-block', type: 'button', onClick: () => fileInput.click() }, 'バックアップから復元'),
    h('button', { class: 'btn btn-block', type: 'button', onClick: prepare('CSV', createCsvFile) }, 'CSV を作成'),
  );
  renderActions();

  return h('section', { class: 'card stack' },
    h('h2', {}, 'バックアップ'),
    lastLine,
    fileInput,
    actions,
    h('p', { class: 'setting-note' }, 'データはこの端末内だけにあり、ホーム画面のアプリを削除すると消えます。共有シートから iCloud Drive などに保存してください。バックアップに API キーとパスコードは含みません。'),
  );
}

function aliasSection(slips, aliases) {
  const names = [...new Set(slips.flatMap((s) => s.items.map((i) => i.name)))].sort((a, b) => a.localeCompare(b, 'ja'));
  if (!names.length) return null;
  const current = { ...aliases };
  return h('section', { class: 'card' },
    h('details', {},
      h('summary', {}, '項目名の統合'),
      h('div', { class: 'stack' },
        h('p', { class: 'setting-note' }, '名前の違う項目を、推移や増減で同じ項目として扱います。右の欄に統合先の名前を入力してください。明細の内容は変わりません。'),
        h('datalist', { id: 'alias-options' }, names.map((n) => h('option', { value: n }))),
        names.map((name) => h('div', { class: 'alias-row' },
          h('span', {}, name),
          h('input', {
            value: current[name] || '',
            list: 'alias-options',
            placeholder: 'そのまま',
            'aria-label': `${name}の統合先`,
            onChange: async (e) => {
              const value = e.target.value.trim();
              if (value && value !== name) current[name] = value;
              else delete current[name];
              await db.settings.set('aliases', current);
            },
          }),
        )),
      ),
    ),
  );
}

export async function renderSettings() {
  const [apiKey, { startMonth, aliases }, passcode, lastBackupAt, slips] = await Promise.all([
    db.settings.get('apiKey'),
    getSettings(),
    hasPasscode(),
    db.settings.get('lastBackupAt'),
    db.payslips.all(),
  ]);
  return h('div', {},
    topbar('設定'),
    h('div', { class: 'page' },
      apiKeySection(Boolean(apiKey)),
      backupSection(lastBackupAt),
      yearSection(startMonth),
      aliasSection(slips, aliases),
      passcodeSection(passcode),
    ),
  );
}
