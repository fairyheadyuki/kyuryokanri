// 推移。今年と前年の月別の値を折れ線で比べる。
import { db } from '../db.js';
import { canonicalName, getSettings, monthIndex, UNIT_LABEL, yearLabel, yearOf } from '../domain.js';
import { go, topbar } from '../router.js';
import { currentYearMonth, h, svg, yen } from '../util.js';

const CHART = { w: 360, h: 220, left: 52, right: 12, top: 12, bottom: 24 };
const BASE_METRICS = [
  { id: 'net', label: '手取り', unit: 'yen', get: (s) => s.net },
  { id: 'gross', label: '総支給額', unit: 'yen', get: (s) => s.gross },
  { id: 'deduction', label: '控除合計', unit: 'yen', get: (s) => s.deductionTotal },
];
const KINDS = [
  { id: 'salary', label: '給与' },
  { id: 'bonus', label: '賞与' },
  { id: 'all', label: 'すべて' },
];

let view = { metric: 'net', kind: 'salary', year: null };

// 有給残数のような残高の項目。足し合わせても意味がないので合計を出さない(残業は含まない)
const isBalance = (name) => /(有給|有休|年休|休暇|代休).*残|残(数|日数|高|時間|り)|残$/.test(name);

function itemMetrics(slips, aliases) {
  const found = new Map();
  for (const s of slips) {
    for (const i of s.items) {
      const name = canonicalName(i.name, aliases);
      if (!found.has(name)) found.set(name, i.unit);
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
    .map(([name, unit]) => ({
      id: `item:${name}`,
      label: name,
      unit,
      balance: isBalance(name),
      get: (s) => {
        const hits = s.items.filter((i) => canonicalName(i.name, aliases) === name && typeof i.value === 'number');
        return hits.length ? hits.reduce((acc, i) => acc + i.value, 0) : null;
      },
    }));
}

function monthlySeries(slips, metric, year, startMonth) {
  const values = Array(12).fill(null);
  for (const s of slips) {
    if (yearOf(s.yearMonth, startMonth) !== year) continue;
    const v = metric.get(s);
    if (typeof v !== 'number') continue;
    const i = monthIndex(Number(s.yearMonth.slice(5, 7)), startMonth);
    values[i] = metric.balance ? v : (values[i] || 0) + v;
  }
  return values;
}

function niceTicks(min, max) {
  const span = Math.max(max - min, Math.abs(max) * 0.1, 1);
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return ticks;
}

function formatTick(v, unit) {
  if (unit !== 'yen') return `${v.toLocaleString('ja-JP')}${UNIT_LABEL[unit]}`;
  if (Math.abs(v) >= 10000) return `${(v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万円`;
  return `${v.toLocaleString('ja-JP')}円`;
}

const formatValue = (v, unit) => (v === null ? '―' : unit === 'yen' ? `${yen(v)}円` : `${v.toLocaleString('ja-JP')}${UNIT_LABEL[unit]}`);
const formatDiff = (v, unit) => `${v.toLocaleString('ja-JP', { signDisplay: 'always' })}${UNIT_LABEL[unit]}`;

function linePath(values, x, y) {
  // 明細のない月は線をつながない
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function buildChart(current, previous, months, unit, labels) {
  const all = [...current, ...previous].filter((v) => v !== null);
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  // 変動が見えるよう、値が近いときは0から始めない
  const ticks = niceTicks(dataMin > dataMax * 0.5 ? dataMin : Math.min(0, dataMin), dataMax);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const { w, h: height, left, right, top, bottom } = CHART;
  const x = (i) => left + (i + 0.5) * ((w - left - right) / 12);
  const y = (v) => top + (1 - (v - lo) / (hi - lo || 1)) * (height - top - bottom);

  const dots = (values, cls) => values.map((v, i) =>
    v === null ? null : svg('circle', { class: `dot ${cls}`, cx: x(i), cy: y(v), r: 4 }));
  const cross = svg('line', { class: 'cross', y1: top, y2: height - bottom, visibility: 'hidden' });

  const chart = svg('svg', {
    viewBox: `0 0 ${w} ${height}`,
    role: 'img',
    'aria-label': `${labels.current}の月別推移。値は下の表にあります。`,
  },
    ticks.map((t) => svg('line', { class: t === lo ? 'baseline' : 'grid', x1: left, x2: w - right, y1: y(t), y2: y(t) })),
    ticks.map((t) => svg('text', { class: 'tick', x: left - 6, y: y(t) + 4, 'text-anchor': 'end' }, formatTick(t, unit))),
    months.map((m, i) => svg('text', { class: 'tick', x: x(i), y: height - 7, 'text-anchor': 'middle' }, String(m))),
    cross,
    svg('path', { class: 'line s2', d: linePath(previous, x, y) }),
    dots(previous, 's2'),
    svg('path', { class: 'line s1', d: linePath(current, x, y) }),
    dots(current, 's1'),
  );

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' }, chart, tip);
  const hasPrev = previous.some((v) => v !== null);

  const show = (e) => {
    const box = chart.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * w;
    const i = Math.max(0, Math.min(11, Math.floor((sx - left) / ((w - left - right) / 12))));
    if (current[i] === null && previous[i] === null) { hide(); return; }
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      h('div', {}, h('strong', {}, `${months[i]}月`)),
      h('div', { class: 'num' }, `${labels.current}: ${formatValue(current[i], unit)}`),
      hasPrev && h('div', { class: 'num' }, `${labels.previous}: ${formatValue(previous[i], unit)}`),
    );
    tip.hidden = false;
    const px = (x(i) / w) * box.width;
    const tipW = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(box.width - tipW, px < box.width / 2 ? px + 10 : px - tipW - 10))}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  chart.addEventListener('pointerdown', show);
  chart.addEventListener('pointermove', show);
  chart.addEventListener('pointerleave', hide);
  return wrap;
}

export async function renderTrends() {
  const [slips, { startMonth, aliases }] = await Promise.all([db.payslips.all(), getSettings()]);
  const thisYear = yearOf(currentYearMonth(), startMonth);
  const years = [...new Set([thisYear, ...slips.map((s) => yearOf(s.yearMonth, startMonth))])].sort((a, b) => a - b);
  if (!years.includes(view.year)) view.year = slips.length ? Math.max(...slips.map((s) => yearOf(s.yearMonth, startMonth))) : thisYear;
  const year = view.year;
  const index = years.indexOf(year);

  // 表示中の年と前年、選択中の種別に値がある項目だけを選択肢にする
  const filtered = slips.filter((s) => view.kind === 'all' || s.kind === view.kind);
  const shown = filtered.filter((s) => [year, year - 1].includes(yearOf(s.yearMonth, startMonth)));
  const metrics = [...BASE_METRICS, ...itemMetrics(shown, aliases)]
    .filter((m) => shown.some((s) => { const v = m.get(s); return typeof v === 'number' && v !== 0; }));
  const metric = metrics.find((m) => m.id === view.metric) || metrics[0] || null;

  const update = (patch) => { view = { ...view, ...patch }; go('trends'); };

  const header = topbar('推移');
  if (!slips.length) {
    return h('div', {}, header, h('div', { class: 'page' }, h('p', { class: 'empty muted' }, '明細を追加すると、ここに推移が表示されます。')));
  }

  const current = metric ? monthlySeries(filtered, metric, year, startMonth) : Array(12).fill(null);
  const previous = metric ? monthlySeries(filtered, metric, year - 1, startMonth) : Array(12).fill(null);
  const months = Array.from({ length: 12 }, (_, i) => ((startMonth - 1 + i) % 12) + 1);
  const labels = { current: yearLabel(year, startMonth), previous: yearLabel(year - 1, startMonth) };
  const hasCurrent = current.some((v) => v !== null);
  const hasPrev = previous.some((v) => v !== null);
  const sum = (vals) => vals.reduce((acc, v) => acc + (v || 0), 0);

  return h('div', {},
    header,
    h('div', { class: 'page' },
      h('div', { class: 'year-switch' },
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '前の年', disabled: index === 0, onClick: () => update({ year: years[index - 1] }) }, '‹'),
        h('strong', {}, labels.current),
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '次の年', disabled: index === years.length - 1, onClick: () => update({ year: years[index + 1] }) }, '›'),
      ),
      metric && h('label', {}, '表示する項目',
        h('select', { onChange: (e) => update({ metric: e.target.value }) },
          metrics.map((m) => h('option', { value: m.id, selected: m.id === metric.id }, m.label)))),
      h('div', { class: 'chips', role: 'group', 'aria-label': '明細の種別' },
        KINDS.map((k) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(view.kind === k.id), onClick: () => update({ kind: k.id }) }, k.label))),
      hasCurrent || hasPrev
        ? [
          h('section', { class: 'card' },
            hasCurrent && hasPrev && h('div', { class: 'legend' },
              h('span', {}, h('span', { class: 'legend-key s1' }), labels.current),
              h('span', {}, h('span', { class: 'legend-key s2' }), labels.previous),
            ),
            buildChart(current, previous, months, metric.unit, labels),
            h('p', { class: 'small muted' }, 'グラフをタップすると値を表示します。横軸は月です。'),
          ),
          h('section', { class: 'card' },
            h('table', { class: 'table' },
              h('thead', {}, h('tr', {},
                h('th', { scope: 'col' }, '月'),
                h('th', { scope: 'col' }, labels.current),
                hasPrev && h('th', { scope: 'col' }, labels.previous),
                hasPrev && h('th', { scope: 'col' }, '前年差'),
              )),
              h('tbody', {}, months.map((m, i) => {
                if (current[i] === null && previous[i] === null) return null;
                const both = current[i] !== null && previous[i] !== null;
                return h('tr', {},
                  h('th', { scope: 'row' }, `${m}月`),
                  h('td', {}, formatValue(current[i], metric.unit)),
                  hasPrev && h('td', {}, formatValue(previous[i], metric.unit)),
                  hasPrev && h('td', {}, both ? formatDiff(current[i] - previous[i], metric.unit) : '―'),
                );
              })),
              !metric.balance && h('tfoot', {}, h('tr', {},
                h('th', { scope: 'row' }, '合計'),
                h('td', {}, formatValue(sum(current), metric.unit)),
                hasPrev && h('td', {}, formatValue(sum(previous), metric.unit)),
                hasPrev && h('td', {}, ''),
              )),
            ),
          ),
        ]
        : h('p', { class: 'empty muted' }, 'この条件の明細はありません。'),
    ),
  );
}
