import { h, svg } from './util.js';
import { go, onNavigate, registerView } from './router.js';
import { initLock } from './lock.js';
import { renderList } from './views/list.js';
import { renderDetail } from './views/detail.js';
import { renderForm } from './views/form.js';
import { renderAdd } from './views/add.js';
import { renderRedact } from './views/redact.js';
import { renderTrends } from './views/trends.js';
import { renderSettings } from './views/settings.js';

registerView('list', renderList, { tab: 'list' });
registerView('detail', renderDetail, { tab: 'list' });
registerView('add', renderAdd, { tab: 'add' });
registerView('redact', renderRedact, { fullscreen: true });
registerView('form', renderForm, { fullscreen: true });
registerView('trends', renderTrends, { tab: 'trends' });
registerView('settings', renderSettings, { tab: 'settings' });

const icon = (...paths) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, paths.map((d) => svg('path', { d })));

const TABS = [
  { name: 'list', label: '一覧', icon: () => icon('M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01') },
  { name: 'add', label: '追加', icon: () => icon('M12 5v14', 'M5 12h14') },
  { name: 'trends', label: '推移', icon: () => icon('M4 19h16', 'M5 15l5-5 4 3 5-7') },
  { name: 'settings', label: '設定', icon: () => icon('M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4') },
];

const tabsEl = document.getElementById('tabs');
const buttons = {};
for (const tab of TABS) {
  buttons[tab.name] = h('button', { class: 'tab', type: 'button', onClick: () => go(tab.name) }, tab.icon(), tab.label);
  tabsEl.append(buttons[tab.name]);
}

onNavigate((view) => {
  tabsEl.hidden = view.fullscreen;
  for (const tab of TABS) {
    if (tab.name === view.tab) buttons[tab.name].setAttribute('aria-current', 'page');
    else buttons[tab.name].removeAttribute('aria-current');
  }
});

await initLock();
await go('list');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
