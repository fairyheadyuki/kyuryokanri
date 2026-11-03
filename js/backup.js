// バックアップ(JSON、画像込み)と CSV 書き出し。API キーとパスコードは含めない。
import { db } from './db.js';
import { getSettings, sortSlips, KIND_LABEL, CATEGORY_LABEL, UNIT_LABEL } from './domain.js';

const FORMAT = 'payslip-app-backup';

const stamp = () => new Date().toISOString().slice(0, 10);

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  const [meta, data] = url.split(',');
  const type = meta.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function createBackupFile() {
  const [payslips, settings] = await Promise.all([db.payslips.all(), getSettings()]);
  const images = {};
  for (const slip of payslips) {
    if (!slip.imageId) continue;
    const blob = await db.images.get(slip.imageId);
    if (blob) images[slip.imageId] = await blobToDataUrl(blob);
  }
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), settings, payslips, images });
  return new File([json], `kyuryo-backup-${stamp()}.json`, { type: 'application/json' });
}

// 同じ ID の明細は上書きし、それ以外の既存データは残す。読み込んだ件数を返す
export async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('ファイルを読み込めませんでした。');
  }
  if (data.format !== FORMAT || !Array.isArray(data.payslips)) {
    throw new Error('このアプリのバックアップファイルではありません。');
  }
  for (const slip of data.payslips) {
    if (!slip.id || !/^\d{4}-\d{2}$/.test(slip.yearMonth) || !Array.isArray(slip.items)) {
      throw new Error('バックアップの内容が正しくありません。');
    }
  }
  for (const [id, url] of Object.entries(data.images || {})) {
    await db.images.put(id, await dataUrlToBlob(url));
  }
  for (const slip of data.payslips) await db.payslips.put(slip);
  if (data.settings?.startMonth) await db.settings.set('startMonth', data.settings.startMonth);
  if (data.settings?.aliases) await db.settings.set('aliases', data.settings.aliases);
  return data.payslips.length;
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function createCsvFile() {
  const slips = sortSlips(await db.payslips.all());
  const rows = [['対象月', '種別', '支給日', '勤務先', '区分', '項目', '値', '単位']];
  for (const s of slips) {
    const base = [s.yearMonth, KIND_LABEL[s.kind], s.payDate, s.employer];
    rows.push([...base, '合計', '総支給額', s.gross, '円']);
    rows.push([...base, '合計', '控除合計', s.deductionTotal, '円']);
    rows.push([...base, '合計', '差引支給額', s.net, '円']);
    for (const i of s.items) rows.push([...base, CATEGORY_LABEL[i.category], i.name, i.value, UNIT_LABEL[i.unit]]);
  }
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  // Excel で文字化けしないよう BOM を付ける
  return new File(['﻿' + text], `kyuryo-${stamp()}.csv`, { type: 'text/csv' });
}
