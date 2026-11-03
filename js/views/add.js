import { db } from '../db.js';
import { go, topbar } from '../router.js';
import { manualDraft, startScan } from '../scan.js';
import { h } from '../util.js';

export async function renderAdd() {
  const apiKey = await db.settings.get('apiKey');

  const onPick = (e) => {
    if (e.target.files.length) startScan(e.target.files);
  };
  const camera = h('input', { class: 'visually-hidden', type: 'file', accept: 'image/*', capture: 'environment', tabindex: '-1', 'aria-hidden': 'true', onChange: onPick });
  const library = h('input', { class: 'visually-hidden', type: 'file', accept: 'image/*', multiple: true, tabindex: '-1', 'aria-hidden': 'true', onChange: onPick });

  return h('div', {},
    topbar('明細を追加'),
    h('div', { class: 'page' },
      !apiKey && h('div', { class: 'banner' },
        h('span', { class: 'grow' }, '読み取りには API キーの設定が必要です。'),
        h('button', { class: 'btn', type: 'button', onClick: () => go('settings') }, '設定へ'),
      ),
      camera,
      library,
      h('button', { class: 'btn choice', type: 'button', disabled: !apiKey, onClick: () => camera.click() },
        h('strong', {}, '明細を撮影する'),
        h('span', {}, '紙の明細をカメラで撮影します'),
      ),
      h('button', { class: 'btn choice', type: 'button', disabled: !apiKey, onClick: () => library.click() },
        h('strong', {}, '画像を選ぶ'),
        h('span', {}, 'スクリーンショットや保存済みの画像から選びます。複数枚を選べます'),
      ),
      h('button', { class: 'btn choice', type: 'button', onClick: async () => go('form', { slip: await manualDraft() }) },
        h('strong', {}, '手動で入力する'),
        h('span', {}, '前回の項目名を引き継いで入力できます'),
      ),
      h('p', { class: 'small muted' }, '読み取りでは、会社名や氏名を黒塗りしてから画像を Claude API へ送信します。手動入力では外部に送信しません。'),
    ),
  );
}
