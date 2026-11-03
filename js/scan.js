// 複数枚の読み取りの進行管理と、API の結果から入力フォーム用の下書きへの変換
import { db } from './db.js';
import { emptySlip, sortSlips } from './domain.js';
import { go } from './router.js';
import { currentYearMonth } from './util.js';

const state = { files: [], index: 0 };

export function startScan(files) {
  state.files = [...files];
  state.index = 0;
  go('redact', { file: state.files[0] });
}

export function nextScan() {
  state.index += 1;
  if (state.index < state.files.length) {
    go('redact', { file: state.files[state.index] });
  } else {
    state.files = [];
    go('list');
  }
}

export function scanProgress() {
  return state.files.length > 1 ? `(${state.index + 1}/${state.files.length})` : '';
}

async function lastEmployer() {
  const slips = sortSlips(await db.payslips.all());
  return slips[0]?.employer || '';
}

const validMonth = (s) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(s || '') ? s : '');
const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');

export async function toDraft(result) {
  return {
    ...emptySlip(''),
    source: 'scan',
    kind: result.kind,
    yearMonth: validMonth(result.year_month),
    payDate: validDate(result.pay_date),
    employer: await lastEmployer(), // 勤務先は画像から読まない
    gross: result.gross,
    deductionTotal: result.deduction_total,
    net: result.net,
    items: result.items.map((i) => ({
      category: i.category,
      name: i.name,
      value: i.value,
      unit: i.category === 'earning' || i.category === 'deduction' ? 'yen' : i.unit,
    })),
  };
}

// 手動入力の下書き。前回の項目名を引き継ぎ、金額は空欄にする
export async function manualDraft() {
  const slips = sortSlips(await db.payslips.all());
  const prev = slips.find((s) => s.kind === 'salary');
  return {
    ...emptySlip(currentYearMonth()),
    employer: slips[0]?.employer || '',
    items: prev ? prev.items.map((i) => ({ ...i, value: null })) : [],
  };
}
