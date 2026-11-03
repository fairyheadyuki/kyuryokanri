// DOM 生成と書式の共通処理。CSP と XSS 対策のため innerHTML は使わない。
const SVG_NS = 'http://www.w3.org/2000/svg';

function build(node, props, children) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.setAttribute('class', value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'multiple') node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }
  return node;
}

export const h = (tag, props, ...children) => build(document.createElement(tag), props, children);
export const svg = (tag, props, ...children) => build(document.createElementNS(SVG_NS, tag), props, children);

export const yen = (n) => (n === null || n === undefined || n === '' ? '―' : Math.round(n).toLocaleString('ja-JP'));
export const signedYen = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString('ja-JP');

// 全角数字やカンマ、「円」が混ざっても数値にする。読めなければ null
export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const s = String(text)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー－]/g, '-')
    .replace(/[,，\s円]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const uuid = () => crypto.randomUUID();

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

// 確認ダイアログ。OK で true を返す
export function confirmDialog({ title, body, ok = 'OK', cancel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const close = (result) => { overlay.remove(); resolve(result); };
    const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-card' },
        h('h2', {}, title),
        body && h('p', {}, body),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', type: 'button', onClick: () => close(false) }, cancel),
          h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', onClick: () => close(true) }, ok),
        ),
      ),
    );
    document.body.append(overlay);
  });
}

// iPhone では共有シート、それ以外はダウンロードでファイルを渡す。保存されたら true
export async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // 共有できない環境ならダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
