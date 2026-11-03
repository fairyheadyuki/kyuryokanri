import { db } from '../db.js';
import { getSettings, KIND_LABEL, sortSlips, totals, yearLabel, yearOf } from '../domain.js';
import { go, topbar } from '../router.js';
import { currentYearMonth, h, monthLabel, yen } from '../util.js';

const BACKUP_NUDGE_DAYS = 30;
let selectedYear = null;

async function backupBanner(slips) {
  if (!slips.length) return null;
  const last = await db.settings.get('lastBackupAt');
  const latest = slips.reduce((acc, s) => (s.updatedAt > acc ? s.updatedAt : acc), '');
  if (last && latest <= last) return null;
  if (last && Date.now() - new Date(last).getTime() < BACKUP_NUDGE_DAYS * 86400000) return null;
  return h('div', { class: 'banner' },
    h('span', { class: 'grow' }, last ? '前回のバックアップから時間が経っています。' : 'まだバックアップがありません。'),
    h('button', { class: 'btn', type: 'button', onClick: () => go('settings') }, '設定へ'),
  );
}

export async function renderList() {
  const [slips, { startMonth }] = await Promise.all([db.payslips.all(), getSettings()]);
  const thisYear = yearOf(currentYearMonth(), startMonth);
  const years = [...new Set([thisYear, ...slips.map((s) => yearOf(s.yearMonth, startMonth))])].sort((a, b) => a - b);
  const year = years.includes(selectedYear) ? selectedYear : (slips.length ? yearOf(sortSlips(slips)[0].yearMonth, startMonth) : thisYear);
  selectedYear = year;
  const index = years.indexOf(year);
  const inYear = sortSlips(slips.filter((s) => yearOf(s.yearMonth, startMonth) === year));
  const sum = totals(inYear);

  const move = (delta) => { selectedYear = years[index + delta]; go('list'); };
  const switcher = h('div', { class: 'year-switch' },
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '前の年', disabled: index === 0, onClick: () => move(-1) }, '‹'),
    h('strong', {}, yearLabel(year, startMonth)),
    h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '次の年', disabled: index === years.length - 1, onClick: () => move(1) }, '›'),
  );

  const body = slips.length === 0
    ? h('div', { class: 'empty' },
      h('p', {}, 'まだ明細がありません。'),
      h('p', { class: 'muted small' }, '給料明細を撮影するか、手動で入力して記録を始めましょう。'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => go('add') }, '明細を追加'),
    )
    : [
      switcher,
      h('section', { class: 'card', 'aria-label': '年間合計' },
        h('p', { class: 'small muted' }, '手取り合計'),
        h('p', { class: 'summary-net' }, `${yen(sum.net)}円`),
        h('div', { class: 'summary-sub' },
          h('span', {}, `総支給 ${yen(sum.gross)}円`),
          h('span', {}, `控除 ${yen(sum.deduction)}円`),
        ),
      ),
      inYear.length === 0
        ? h('p', { class: 'muted small empty' }, 'この年の明細はありません。')
        : h('section', { class: 'card month-list', 'aria-label': '月別一覧' }, inYear.map((s) => {
          const { month } = monthLabel(s.yearMonth);
          return h('button', { class: 'month-row', type: 'button', onClick: () => go('detail', { id: s.id }) },
            h('span', { class: 'month-name' }, `${month}月`),
            s.kind !== 'salary' && h('span', { class: 'badge' }, KIND_LABEL[s.kind]),
            h('span', { class: 'month-values num' },
              h('span', { class: 'month-net' }, `${yen(s.net)}円`),
              h('span', { class: 'small muted', 'aria-label': '総支給' }, ` / ${yen(s.gross)}`),
            ),
          );
        })),
    ];

  return h('div', {},
    topbar('給料明細'),
    h('div', { class: 'page' }, await backupBanner(slips), body),
  );
}
