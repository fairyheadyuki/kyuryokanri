// 明細の入力・確認フォーム。手動入力、読み取り結果の確認、編集で共通に使う。
import { db } from '../db.js';
import { CATEGORY_LABEL, CATEGORIES, KIND_LABEL, saveSlip, sumItems, UNIT_LABEL, validate } from '../domain.js';
import { nextScan, scanProgress } from '../scan.js';
import { go, topbar } from '../router.js';
import { confirmDialog, h, parseNumber, toast } from '../util.js';

const asText = (v) => (v === null || v === undefined ? '' : String(v));

export async function renderForm({ slip, imageBlob = null, flow = false, title = '明細を入力' }, ctx) {
  const others = await db.payslips.all();
  const rows = new Map(); // カテゴリごとの行要素
  let refresh = () => {};

  // ---- 入力欄 ----
  const kind = h('select', { onChange: () => refresh() },
    Object.entries(KIND_LABEL).map(([value, label]) => h('option', { value, selected: value === slip.kind }, label)));
  const yearMonth = h('input', { type: 'month', value: slip.yearMonth, onInput: () => { yearMonth.classList.remove('field-error'); refresh(); } });
  const payDate = h('input', { type: 'date', value: slip.payDate });
  const employers = [...new Set(others.map((o) => o.employer).filter(Boolean))];
  const employer = h('input', { value: slip.employer, list: 'employer-options', autocomplete: 'off' });
  const gross = h('input', { class: 'num', inputmode: 'numeric', value: asText(slip.gross), onInput: () => refresh() });
  const deductionTotal = h('input', { class: 'num', inputmode: 'numeric', value: asText(slip.deductionTotal), onInput: () => refresh() });
  const net = h('input', { class: 'num', inputmode: 'numeric', value: asText(slip.net), onInput: () => refresh() });
  const note = h('textarea', { rows: '2', value: slip.note });
  const warningBox = h('div', { class: 'warnings', role: 'status', hidden: true });

  // ---- 項目行 ----
  function itemRow(item, list) {
    const name = h('input', { class: 'item-name', value: item.name, placeholder: '項目名', 'aria-label': '項目名', onInput: () => refresh() });
    const value = h('input', { class: 'item-value', inputmode: 'decimal', value: asText(item.value), 'aria-label': '値', onInput: () => refresh() });
    const withUnit = item.category === 'attendance' || item.category === 'other';
    const unit = withUnit
      ? h('select', { class: 'item-unit', 'aria-label': '単位' },
        Object.entries(UNIT_LABEL).map(([v, label]) => h('option', { value: v, selected: v === item.unit }, label)))
      : null;
    // iPhone の数字キーボードにはマイナスがないので、還付用に符号の切り替えを用意する
    const flip = item.category === 'deduction'
      ? h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': '符号を反転', onClick: () => {
        const n = parseNumber(value.value);
        if (n !== null) { value.value = String(-n); refresh(); }
      } }, '±')
      : null;
    const row = h('div', { class: 'item-row' }, name, value, unit, flip,
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `${item.name || '項目'}を削除`, onClick: () => { row.remove(); refresh(); } }, '×'));
    row.read = () => ({
      category: item.category,
      name: name.value.trim(),
      value: parseNumber(value.value),
      unit: unit ? unit.value : 'yen',
    });
    row.markBlank = () => value.classList.toggle('blank', parseNumber(value.value) === null && name.value.trim() !== '' && slip.source === 'scan');
    list.append(row);
    return row;
  }

  const sections = CATEGORIES.map((category) => {
    const list = h('div', { class: 'stack' });
    rows.set(category, list);
    slip.items.filter((i) => i.category === category).forEach((i) => itemRow(i, list));
    return h('section', { class: 'card' },
      h('h2', {}, CATEGORY_LABEL[category]),
      list,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => {
        const row = itemRow({ category, name: '', value: null, unit: category === 'attendance' ? 'day' : 'yen' }, list);
        row.querySelector('input').focus();
        refresh();
      } }, '+ 項目を追加'),
    );
  });

  // ---- 読み出しと検証 ----
  function readItems() {
    const items = [];
    for (const list of rows.values()) {
      for (const row of list.children) {
        const item = row.read();
        if (!item.name && item.value === null) continue;
        // 手動入力では空欄の行は「なし」とみなす。読み取りでは未読を残す
        if (slip.source === 'manual' && item.value === null) continue;
        items.push(item);
      }
    }
    return items;
  }

  function read() {
    return {
      ...slip,
      kind: kind.value,
      yearMonth: yearMonth.value,
      payDate: payDate.value,
      employer: employer.value.trim(),
      gross: parseNumber(gross.value),
      deductionTotal: parseNumber(deductionTotal.value),
      net: parseNumber(net.value),
      note: note.value.trim(),
      items: readItems(),
    };
  }

  refresh = () => {
    for (const list of rows.values()) for (const row of list.children) row.markBlank();
    const warnings = validate(read(), others);
    warningBox.replaceChildren(...warnings.map((w) => h('p', {}, w)));
    warningBox.hidden = warnings.length === 0;
  };

  // ---- 保存 ----
  const save = async () => {
    const record = read();
    if (!/^\d{4}-\d{2}$/.test(record.yearMonth)) {
      yearMonth.classList.add('field-error');
      yearMonth.focus();
      toast('対象月を入力してください');
      return;
    }
    // 合計が空欄なら項目から計算する
    if (record.gross === null && record.items.some((i) => i.category === 'earning')) record.gross = sumItems(record.items, 'earning');
    if (record.deductionTotal === null && record.items.some((i) => i.category === 'deduction')) record.deductionTotal = sumItems(record.items, 'deduction');
    if (record.net === null && record.gross !== null) record.net = record.gross - (record.deductionTotal || 0);
    await saveSlip(record, imageBlob);
    toast('保存しました');
    if (flow) nextScan();
    else go('detail', { id: record.id });
  };

  const cancel = async () => {
    const ok = await confirmDialog({ title: '入力を破棄しますか?', body: '保存していない内容は失われます。', ok: '破棄', danger: true });
    if (!ok) return;
    if (flow) nextScan();
    else if (slip.createdAt) go('detail', { id: slip.id });
    else go('add');
  };

  // ---- 画像 ----
  let imageSection = null;
  const source = imageBlob || (slip.imageId ? await db.images.get(slip.imageId) : null);
  if (source) {
    const url = URL.createObjectURL(source);
    ctx.onLeave(() => URL.revokeObjectURL(url));
    imageSection = h('div', { class: 'form-image' },
      h('div', { class: 'form-image-scroll' }, h('img', { src: url, alt: '明細画像。タップで拡大', onClick: () => imageSection.classList.toggle('open') })),
      h('p', { class: 'small muted' }, 'タップで拡大。結果と見比べて確認してください。'),
    );
  }

  refresh();
  const progress = flow ? scanProgress() : '';
  return h('div', {},
    topbar(`${title}${progress}`,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: cancel }, '取消'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: save }, '保存'),
    ),
    imageSection,
    h('div', { class: 'page' },
      warningBox,
      h('section', { class: 'card stack' },
        h('div', { class: 'field-row' },
          h('label', {}, '種別', kind),
          h('label', {}, '対象月', yearMonth),
        ),
        h('label', {}, '支給日', payDate),
        h('label', {}, '勤務先', employer, h('datalist', { id: 'employer-options' }, employers.map((e) => h('option', { value: e })))),
      ),
      h('section', { class: 'card stack' },
        h('h2', {}, '合計'),
        h('label', {}, '総支給額(円)', gross),
        h('label', {}, '控除合計(円)', deductionTotal),
        h('label', {}, '差引支給額・手取り(円)', net),
        slip.source === 'manual' && h('p', { class: 'small muted' }, '空欄のまま保存すると、項目の金額から計算します。'),
      ),
      sections,
      h('section', { class: 'card' }, h('label', {}, 'メモ', note)),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, '保存'),
    ),
  );
}
