import { db } from '../db.js';
import { CATEGORIES, CATEGORY_LABEL, deleteSlip, getSettings, canonicalName, KIND_LABEL, previousOf, UNIT_LABEL } from '../domain.js';
import { go, topbar } from '../router.js';
import { confirmDialog, h, monthLabel, signedYen, toast, yen } from '../util.js';

function formatValue(item) {
  if (item.value === null) return '―';
  return item.unit === 'yen' ? `${yen(item.value)}円` : `${item.value.toLocaleString('ja-JP')}${UNIT_LABEL[item.unit]}`;
}

export async function renderDetail({ id }, ctx) {
  const [slip, all, { aliases }] = await Promise.all([db.payslips.get(id), db.payslips.all(), getSettings()]);
  if (!slip) {
    toast('明細が見つかりません');
    return renderMissing();
  }
  const prev = previousOf(slip, all);
  const { year, month } = monthLabel(slip.yearMonth);

  const prevValue = (item) => {
    if (!prev) return null;
    const key = canonicalName(item.name, aliases);
    const found = prev.items.find((i) => i.category === item.category && canonicalName(i.name, aliases) === key);
    return found && typeof found.value === 'number' ? found.value : null;
  };
  const deltaNode = (now, before, unit = 'yen') => {
    if (typeof now !== 'number' || typeof before !== 'number' || now === before) return null;
    return h('span', { class: 'delta' }, `${signedYen(now - before)}${unit === 'yen' ? '円' : UNIT_LABEL[unit]}`);
  };

  const imageNode = [];
  if (slip.imageId) {
    const blob = await db.images.get(slip.imageId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      ctx.onLeave(() => URL.revokeObjectURL(url));
      imageNode.push(h('details', { class: 'card' },
        h('summary', {}, '明細画像'),
        h('img', { class: 'slip-image', src: url, alt: '黒塗り後の明細画像' }),
      ));
    }
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'この明細を削除しますか?',
      body: '画像も一緒に削除します。元に戻せません。',
      ok: '削除',
      danger: true,
    });
    if (!ok) return;
    await deleteSlip(slip);
    toast('削除しました');
    go('list');
  };

  return h('div', {},
    topbar(`${year}年${month}月 ${KIND_LABEL[slip.kind]}`,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => go('list') }, '‹ 一覧'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => go('form', { slip, title: '明細を編集' }) }, '編集'),
    ),
    h('div', { class: 'page' },
      h('section', { class: 'card' },
        h('div', { class: 'kv total' }, h('span', {}, '差引支給額(手取り)'),
          h('span', { class: 'value' }, `${yen(slip.net)}円`, deltaNode(slip.net, prev?.net))),
        h('div', { class: 'kv' }, h('span', {}, '総支給額'),
          h('span', { class: 'value' }, `${yen(slip.gross)}円`, deltaNode(slip.gross, prev?.gross))),
        h('div', { class: 'kv' }, h('span', {}, '控除合計'),
          h('span', { class: 'value' }, `${yen(slip.deductionTotal)}円`, deltaNode(slip.deductionTotal, prev?.deductionTotal))),
        prev && h('p', { class: 'small muted' }, `増減は ${monthLabel(prev.yearMonth).year}年${monthLabel(prev.yearMonth).month}月分との比較です。`),
      ),
      CATEGORIES.map((category) => {
        const items = slip.items.filter((i) => i.category === category);
        if (!items.length) return null;
        return h('section', { class: 'card' },
          h('h2', {}, CATEGORY_LABEL[category]),
          items.map((item) => h('div', { class: 'kv' },
            h('span', {}, item.name),
            h('span', { class: 'value' }, formatValue(item), deltaNode(item.value, prevValue(item), item.unit)),
          )),
        );
      }),
      (slip.payDate || slip.employer || slip.note) && h('section', { class: 'card' },
        slip.payDate && h('div', { class: 'kv' }, h('span', {}, '支給日'), h('span', { class: 'value' }, slip.payDate)),
        slip.employer && h('div', { class: 'kv' }, h('span', {}, '勤務先'), h('span', { class: 'value' }, slip.employer)),
        slip.note && h('div', { class: 'kv' }, h('span', {}, 'メモ'), h('span', { class: 'value' }, slip.note)),
      ),
      imageNode,
      h('button', { class: 'btn btn-block btn-danger-text', type: 'button', onClick: remove }, 'この明細を削除'),
    ),
  );
}

function renderMissing() {
  return h('div', { class: 'page' },
    h('button', { class: 'btn', type: 'button', onClick: () => go('list') }, '一覧へ戻る'),
  );
}
