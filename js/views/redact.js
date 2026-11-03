// 黒塗り画面。範囲は画像に対する比率(0〜1)で持ち、送信時に画素へ書き込む。
import { readPayslip } from '../claude.js';
import { db } from '../db.js';
import { go, topbar } from '../router.js';
import { manualDraft, nextScan, scanProgress, toDraft } from '../scan.js';
import { confirmDialog, h } from '../util.js';

const MAX_EDGE = 1568; // API が縮小せずに扱える長辺の目安
const JPEG_QUALITY = 0.85;
const MIN_RECT_CSS_PX = 8;
const HANDLE_CSS_PX = 22;

async function loadScaled(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode failed'));
      image.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rotated(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.height;
  canvas.height = source.width;
  const c = canvas.getContext('2d');
  c.translate(canvas.width, 0);
  c.rotate(Math.PI / 2);
  c.drawImage(source, 0, 0);
  return canvas;
}

export async function renderRedact({ file }, ctx) {
  const apiKey = await db.settings.get('apiKey');
  let base;
  try {
    base = await loadScaled(file);
  } catch {
    return h('div', {},
      topbar('画像を開けません'),
      h('div', { class: 'page' },
        h('p', {}, 'この画像を読み込めませんでした。別の形式で試してください。'),
        h('button', { class: 'btn', type: 'button', onClick: () => nextScan() }, '次へ進む'),
      ),
    );
  }

  const remembered = (await db.settings.get('lastMasks')) || [];
  let rects = remembered.map((r) => ({ ...r }));
  let selected = null;
  let drag = null;
  let zoom = 1;
  let mode = 'draw';

  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d');
  const stage = h('div', { class: 'redact-stage' }, canvas);

  function paint() {
    canvas.width = base.width;
    canvas.height = base.height;
    ctx2d.drawImage(base, 0, 0);
    ctx2d.fillStyle = '#000';
    for (const r of rects) ctx2d.fillRect(r.x * base.width, r.y * base.height, r.w * base.width, r.h * base.height);
    if (selected) {
      const ratio = base.width / (canvas.getBoundingClientRect().width || base.width);
      const ring = getComputedStyle(document.documentElement).getPropertyValue('--mask-ring').trim();
      ctx2d.strokeStyle = ring;
      ctx2d.fillStyle = ring;
      ctx2d.lineWidth = 2 * ratio;
      const x = selected.x * base.width;
      const y = selected.y * base.height;
      const w = selected.w * base.width;
      const hh = selected.h * base.height;
      ctx2d.strokeRect(x, y, w, hh);
      for (const [cx, cy] of [[x, y], [x + w, y], [x, y + hh], [x + w, y + hh]]) {
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, 6 * ratio, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    deleteBtn.disabled = !selected;
    clearBtn.disabled = rects.length === 0;
  }

  function layout() {
    const availW = stage.clientWidth;
    const availH = stage.clientHeight;
    if (!availW || !availH) return;
    const fit = Math.min(availW / base.width, availH / base.height);
    canvas.style.width = `${Math.round(base.width * fit * zoom)}px`;
    canvas.style.height = `${Math.round(base.height * fit * zoom)}px`;
    paint();
  }

  // ---- 操作 ----
  const pointerPos = (e) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
      box,
    };
  };

  function cornerAt(p) {
    if (!selected) return null;
    const tx = HANDLE_CSS_PX / p.box.width;
    const ty = HANDLE_CSS_PX / p.box.height;
    const corners = [
      { fx: 'x', fy: 'y', x: selected.x, y: selected.y },
      { fx: 'x2', fy: 'y', x: selected.x + selected.w, y: selected.y },
      { fx: 'x', fy: 'y2', x: selected.x, y: selected.y + selected.h },
      { fx: 'x2', fy: 'y2', x: selected.x + selected.w, y: selected.y + selected.h },
    ];
    return corners.find((c) => Math.abs(c.x - p.x) < tx && Math.abs(c.y - p.y) < ty) || null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    const corner = cornerAt(p);
    if (corner) {
      // つかんだ角の対角を固定して伸縮する
      drag = {
        type: 'resize',
        anchorX: corner.fx === 'x' ? selected.x + selected.w : selected.x,
        anchorY: corner.fy === 'y' ? selected.y + selected.h : selected.y,
      };
      return;
    }
    const hit = [...rects].reverse().find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    if (hit) {
      selected = hit;
      drag = { type: 'move', dx: p.x - hit.x, dy: p.y - hit.y };
    } else {
      const rect = { x: p.x, y: p.y, w: 0, h: 0 };
      rects.push(rect);
      selected = rect;
      drag = { type: 'resize', anchorX: p.x, anchorY: p.y };
    }
    paint();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !selected) return;
    e.preventDefault();
    const p = pointerPos(e);
    if (drag.type === 'move') {
      selected.x = Math.min(1 - selected.w, Math.max(0, p.x - drag.dx));
      selected.y = Math.min(1 - selected.h, Math.max(0, p.y - drag.dy));
    } else {
      selected.x = Math.min(p.x, drag.anchorX);
      selected.y = Math.min(p.y, drag.anchorY);
      selected.w = Math.abs(p.x - drag.anchorX);
      selected.h = Math.abs(p.y - drag.anchorY);
    }
    paint();
  });

  const endDrag = (e) => {
    if (!drag) return;
    if (drag.type === 'resize' && selected) {
      const box = canvas.getBoundingClientRect();
      // 誤タップや角のドラッグでできた小さすぎる範囲は捨てる
      if (selected.w * box.width < MIN_RECT_CSS_PX || selected.h * box.height < MIN_RECT_CSS_PX) {
        rects = rects.filter((r) => r !== selected);
        selected = null;
      }
    }
    drag = null;
    paint();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- ツール ----
  const modeBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onClick: () => {
    mode = mode === 'draw' ? 'pan' : 'draw';
    stage.classList.toggle('pan', mode === 'pan');
    modeBtn.setAttribute('aria-pressed', String(mode === 'pan'));
  } }, '画面移動');
  const zoomBtn = h('button', { class: 'btn', type: 'button', onClick: () => {
    zoom = zoom === 1 ? 2 : zoom === 2 ? 3 : 1;
    zoomBtn.textContent = `${zoom}倍`;
    layout();
  } }, '1倍');
  const rotateBtn = h('button', { class: 'btn', type: 'button', onClick: () => {
    base = rotated(base);
    rects = rects.map((r) => {
      const next = { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
      if (r === selected) selected = next;
      return next;
    });
    layout();
  } }, '回転');
  const deleteBtn = h('button', { class: 'btn', type: 'button', onClick: () => {
    rects = rects.filter((r) => r !== selected);
    selected = null;
    paint();
  } }, '削除');
  const clearBtn = h('button', { class: 'btn', type: 'button', onClick: () => {
    rects = [];
    selected = null;
    paint();
  } }, '全消去');

  // ---- 送信 ----
  // 黒塗りを画素に書き込み、再エンコードした JPEG を作る(撮影情報も残らない)
  function renderOutput() {
    const out = document.createElement('canvas');
    out.width = base.width;
    out.height = base.height;
    const c = out.getContext('2d');
    c.fillStyle = '#fff'; // 透過 PNG のスクリーンショット対策
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(base, 0, 0);
    c.fillStyle = '#000';
    for (const r of rects) c.fillRect(r.x * out.width, r.y * out.height, r.w * out.width, r.h * out.height);
    return new Promise((resolve, reject) => {
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('画像を作成できませんでした。'))), 'image/jpeg', JPEG_QUALITY);
    });
  }

  function showBusy() {
    const overlay = h('div', { class: 'modal', role: 'status' },
      h('div', { class: 'modal-card' }, h('div', { class: 'spinner' }), h('p', {}, '読み取り中です…')));
    document.body.append(overlay);
    return overlay;
  }

  function showFailure(message, blob) {
    const overlay = h('div', { class: 'modal', role: 'alertdialog' },
      h('div', { class: 'modal-card' },
        h('h2', {}, '読み取れませんでした'),
        h('p', {}, message),
        h('div', { class: 'modal-actions column' },
          h('button', { class: 'btn btn-primary', type: 'button', onClick: () => { overlay.remove(); send(true); } }, '再試行'),
          h('button', { class: 'btn', type: 'button', onClick: () => {
            overlay.remove();
            manualDraft().then((slip) => go('form', { slip, imageBlob: blob, flow: true }));
          } }, '手動で入力する'),
          h('button', { class: 'btn', type: 'button', onClick: () => overlay.remove() }, '閉じる'),
        ),
      ),
    );
    document.body.append(overlay);
  }

  async function send(skipConfirm = false) {
    if (rects.length === 0 && !skipConfirm) {
      const ok = await confirmDialog({
        title: '黒塗りなしで送信しますか?',
        body: '画像全体がそのまま Claude API へ送信されます。会社名や氏名が写っていないか確認してください。',
        ok: 'そのまま送信',
        danger: true,
      });
      if (!ok) return;
    }
    selected = null;
    paint();
    await db.settings.set('lastMasks', rects.map(({ x, y, w, h: rh }) => ({ x, y, w, h: rh })));
    const busy = showBusy();
    let blob = null;
    try {
      blob = await renderOutput();
      const result = await readPayslip(blob, apiKey);
      const slip = await toDraft(result);
      busy.remove();
      go('form', { slip, imageBlob: blob, flow: true, title: '読み取り結果' });
    } catch (err) {
      busy.remove();
      showFailure(err.message, blob);
    }
  }

  // 画面の回転やツールバーの伸縮に追従する。初回は画面への配置直後に描く
  const observer = new ResizeObserver(() => layout());
  observer.observe(stage);
  ctx.onLeave(() => observer.disconnect());
  setTimeout(layout, 0);

  const cancel = async () => {
    const ok = await confirmDialog({ title: 'この画像の読み取りを中止しますか?', ok: '中止', danger: true });
    if (ok) nextScan();
  };

  return h('div', { class: 'redact' },
    topbar(`黒塗り${scanProgress()}`,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: cancel }, '中止'),
    ),
    h('p', { class: 'redact-note' },
      remembered.length
        ? '前回の黒塗り位置を表示しています。ずれていないか確認してください。'
        : '会社名や氏名などを、指でなぞって隠してください。',
      ' 金額は隠さないでください。'),
    stage,
    h('div', { class: 'redact-tools' }, zoomBtn, modeBtn, rotateBtn, deleteBtn, clearBtn),
    h('div', { class: 'redact-actions' },
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: () => send() }, '送信して読み取る'),
    ),
  );
}
