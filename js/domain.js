// 明細の集計と検証
import { db } from './db.js';
import { uuid } from './util.js';

export const KIND_LABEL = { salary: '給与', bonus: '賞与', other: 'その他' };
export const CATEGORY_LABEL = { earning: '支給', deduction: '控除', attendance: '勤怠', other: 'その他' };
export const UNIT_LABEL = { yen: '円', day: '日', hour: '時間' };
export const CATEGORIES = ['earning', 'deduction', 'attendance', 'other'];

const KIND_ORDER = { bonus: 0, other: 1, salary: 2 };

export function sortSlips(slips) {
  return [...slips].sort((a, b) =>
    b.yearMonth.localeCompare(a.yearMonth) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

// 年の開始月に合わせて、対象年月を「何年分」に振り分ける
export function yearOf(yearMonth, startMonth = 1) {
  const [y, m] = yearMonth.split('-').map(Number);
  return m >= startMonth ? y : y - 1;
}

// 年内の並び順(開始月が0)
export function monthIndex(month, startMonth = 1) {
  return (month - startMonth + 12) % 12;
}

export function yearLabel(year, startMonth = 1) {
  return startMonth === 1 ? `${year}年` : `${year}年度`;
}

export function sumItems(items, category) {
  return items
    .filter((i) => i.category === category && typeof i.value === 'number')
    .reduce((acc, i) => acc + i.value, 0);
}

export function totals(slips) {
  return slips.reduce((acc, s) => ({
    gross: acc.gross + (s.gross || 0),
    deduction: acc.deduction + (s.deductionTotal || 0),
    net: acc.net + (s.net || 0),
  }), { gross: 0, deduction: 0, net: 0 });
}

// 合計の不一致と重複を警告として返す。保存は止めない
export function validate(slip, others) {
  const warnings = [];
  const earningSum = sumItems(slip.items, 'earning');
  const deductionSum = sumItems(slip.items, 'deduction');
  const has = (category) => slip.items.some((i) => i.category === category && typeof i.value === 'number');

  if (slip.gross !== null && has('earning') && earningSum !== slip.gross) {
    warnings.push(`支給項目の合計(${earningSum.toLocaleString('ja-JP')})と総支給額(${slip.gross.toLocaleString('ja-JP')})が一致しません`);
  }
  if (slip.deductionTotal !== null && has('deduction') && deductionSum !== slip.deductionTotal) {
    warnings.push(`控除項目の合計(${deductionSum.toLocaleString('ja-JP')})と控除合計(${slip.deductionTotal.toLocaleString('ja-JP')})が一致しません`);
  }
  if (slip.gross !== null && slip.deductionTotal !== null && slip.net !== null
    && slip.gross - slip.deductionTotal !== slip.net) {
    warnings.push(`総支給額から控除合計を引いた額(${(slip.gross - slip.deductionTotal).toLocaleString('ja-JP')})と差引支給額(${slip.net.toLocaleString('ja-JP')})が一致しません`);
  }
  if (slip.items.some((i) => i.value === null)) {
    warnings.push('値が空欄の項目があります');
  }
  if (others.some((o) => o.id !== slip.id && o.yearMonth === slip.yearMonth && o.kind === slip.kind)) {
    warnings.push(`同じ対象月の${KIND_LABEL[slip.kind]}明細がすでにあります`);
  }
  return warnings;
}

// 同じ種別で直前の明細を返す
export function previousOf(slip, all) {
  return sortSlips(all).find((o) =>
    o.id !== slip.id && o.kind === slip.kind && o.yearMonth < slip.yearMonth) || null;
}

export function emptySlip(yearMonth) {
  return {
    id: uuid(),
    kind: 'salary',
    yearMonth,
    payDate: '',
    employer: '',
    gross: null,
    deductionTotal: null,
    net: null,
    note: '',
    items: [],
    imageId: null,
    source: 'manual',
    createdAt: null,
    updatedAt: null,
  };
}

export async function saveSlip(slip, imageBlob) {
  const now = new Date().toISOString();
  const record = { ...slip, createdAt: slip.createdAt || now, updatedAt: now };
  if (imageBlob && !record.imageId) {
    record.imageId = uuid();
    await db.images.put(record.imageId, imageBlob);
  }
  await db.payslips.put(record);
  // 端末の容量が減っても消されにくくする
  navigator.storage?.persist?.().catch(() => {});
  return record;
}

export async function deleteSlip(slip) {
  if (slip.imageId) await db.images.del(slip.imageId);
  await db.payslips.del(slip.id);
}

export async function getSettings() {
  const [startMonth, aliases] = await Promise.all([
    db.settings.get('startMonth'),
    db.settings.get('aliases'),
  ]);
  return { startMonth: startMonth || 1, aliases: aliases || {} };
}

// 項目名の統合は表示時に当てる。明細そのものは書き換えない
export function canonicalName(name, aliases) {
  return aliases[name] || name;
}
