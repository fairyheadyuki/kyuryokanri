// 画面の切り替え。各画面は render(params, ctx) で Node を返す。
import { h } from './util.js';

const views = {};
let leaveFns = [];
let token = 0;
const listeners = [];

export function registerView(name, render, { fullscreen = false, tab = null } = {}) {
  views[name] = { render, fullscreen, tab };
}

export function onNavigate(fn) { listeners.push(fn); }

export async function go(name, params = {}) {
  const view = views[name];
  const current = ++token;
  leaveFns.forEach((fn) => fn());
  leaveFns = [];
  const ctx = { onLeave: (fn) => leaveFns.push(fn) };
  const node = await view.render(params, ctx);
  if (current !== token) { // 描画中に別の画面へ移った
    leaveFns.forEach((fn) => fn());
    leaveFns = [];
    return;
  }
  const root = document.getElementById('view');
  root.replaceChildren(node);
  root.scrollTop = 0;
  listeners.forEach((fn) => fn(view));
}

export function topbar(title, left, right) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'side' }, left),
    h('h1', {}, title),
    h('div', { class: 'side right' }, right),
  );
}
