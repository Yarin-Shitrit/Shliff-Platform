// Composes the mock's artboards from src/pages/*.html + shared partials.
import fs from 'node:fs';
import path from 'node:path';
import { icon } from './icons.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, 'out');
const LOGO_L = '/_blob/abe46633bf64239605ece9df922f723b';
const LOGO_D = '/_blob/e823c870e6b92f1a2fbcd010b91668e4';

const css = fs.readFileSync(path.join(ROOT, 'src/shared.css'), 'utf8');
const extraCss = `
.logo-d { display: none; }
.app.dark .logo-l { display: none; }
.app.dark .logo-d { display: block; }
`;

const HEAD = `<helmet>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&amp;family=Frank+Ruhl+Libre:wght@500&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap">
  <style>
    body { margin: 0; background: #F6F4F1; }
    a { color: inherit; } a:hover { color: inherit; }
${css}
${extraCss}
  </style>
</helmet>`;

const NAV = [
  { id: 'home', label: 'בית', icon: 'home', href: 'Main.dc.html' },
  { id: 'inbox', label: 'לטיפול', icon: 'inbox', href: 'Inbox.dc.html', count: '12', hot: true },
  { group: 'הקאמפ' },
  { id: 'people', label: 'אנשים', icon: 'users', href: 'People.dc.html', count: '38' },
  { id: 'dues', label: 'דמי קאמפ', icon: 'receipt', href: 'Dues.dc.html' },
  { id: 'tasks', label: 'משימות', icon: 'tasks', href: 'Tasks.dc.html', count: '6' },
  { group: 'כספים' },
  { id: 'money', label: 'סקירה כספית', icon: 'wallet', href: 'Money.dc.html' },
  { id: 'ledger', label: 'תנועות', icon: 'ledger', href: 'Ledger.dc.html' },
  { id: 'budget', label: 'תקציב', icon: 'pie', href: 'Money.dc.html' },
  { id: 'debts', label: 'חובות', icon: 'scale', href: 'Debts.dc.html' },
  { group: 'נתונים' },
  { id: 'files', label: 'קבצים וייבוא', icon: 'sheet', href: 'Files.dc.html' },
];

function sidebar(active) {
  const groups = [];
  let cur = { label: null, items: [] };
  for (const n of NAV) {
    if (n.group) { groups.push(cur); cur = { label: n.group, items: [] }; continue; }
    cur.items.push(n);
  }
  groups.push(cur);
  const item = (n) => `
      <a class="navitem" href="${n.href}"${n.id === active ? ' aria-current="page"' : ''}>
        ${icon(n.icon)}<span>${n.label}</span>${n.count ? `<span class="count${n.hot ? ' hot' : ''}">${n.count}</span>` : ''}
      </a>`;
  const groupHtml = groups.map((g) => `
    <nav class="navgroup"${g.label ? ` aria-label="${g.label}"` : ' aria-label="ראשי"'}>
      ${g.label ? `<div class="navlabel">${g.label}</div>` : ''}${g.items.map(item).join('')}
    </nav>`).join('');
  return `
  <aside class="side">
    <div class="brandrow">
      <img class="logo-l" src="${LOGO_L}" alt="">
      <img class="logo-d" src="${LOGO_D}" alt="">
      <span class="wordmark">קופת שליף</span>
    </div>
    <button class="season-switch" type="button" aria-label="החלפת שנה">
      <span style="display: flex; flex-direction: column;">
        <span class="ss-label">שנה</span>
        <span class="ss-name">ברן 26</span>
      </span>
      <span class="ss-meta"><span class="pill brand" style="height: 20px;">פעילה</span>${icon('updown', 14)}</span>
    </button>
    <button class="searchbtn" type="button">
      ${icon('search')}<span>חיפוש</span><span class="kbd">⌘K</span>
    </button>${groupHtml}
    <div class="sidefoot">
      <a class="navitem" href="Foundations.dc.html">${icon('sliders')}<span>הגדרות</span></a>
      <div class="userrow">
        <span class="av c3">שא</span>
        <span style="display: flex; flex-direction: column; min-width: 0;">
          <span class="u-name">שירה אברהם</span>
          <span class="u-mail">shira@shliff.camp</span>
        </span>
        <button class="btn ghost sm icon" type="button" aria-label="החלפת ערכת צבעים" onClick="{{ toggleTheme }}" style="margin-inline-start: auto;">
          <sc-if value="{{ isDark }}" hint-placeholder-val="{{ false }}">${icon('sun')}</sc-if>
          <sc-if value="{{ isLight }}" hint-placeholder-val="{{ true }}">${icon('moon')}</sc-if>
        </button>
      </div>
    </div>
  </aside>`;
}

const SHELL = `
  shell() {
    const s = this.state || {};
    const dark = s.dark !== undefined ? s.dark : (this.props.theme === 'dark');
    const compact = (this.props.density ?? 'comfortable') === 'compact';
    return {
      themeClass: (dark ? 'dark' : 'light') + (compact ? ' compact' : ''),
      isDark: dark,
      isLight: !dark,
      toggleTheme: () => this.setState({ dark: !dark }),
      searchOpen: !!s.search,
      seasonOpen: !!s.season,
      openSearch: () => this.setState({ search: true, season: false }),
      toggleSeason: () => this.setState({ season: !s.season, search: false }),
      closeOverlays: () => this.setState({ search: false, season: false }),
    };
  }
`;

const OVERLAYS = `
    <sc-if value="{{ seasonOpen }}" hint-placeholder-val="{{ false }}">
      <div>
        <button class="scrim" type="button" aria-label="סגירה" onClick="{{ closeOverlays }}" style="border: 0; padding: 0;"></button>
        <div class="pop" style="top: 92px; inset-inline-start: 254px; width: 260px; z-index: 40;">
          <div class="menusect">שנות פעילות</div>
          <a class="menuitem active" href="Main.dc.html">${icon('check')}<span>ברן 26</span><span class="mi-meta">פעילה</span></a>
          <a class="menuitem" href="Main.dc.html"><span style="width: 16px;"></span><span>ברן 25</span><span class="mi-meta">הסתיימה</span></a>
          <a class="menuitem" href="Main.dc.html"><span style="width: 16px;"></span><span>ברן 24</span><span class="mi-meta">בלי דמי קאמפ</span></a>
          <a class="menuitem" href="Main.dc.html"><span style="width: 16px;"></span><span>ברן 23</span><span class="mi-meta">בלי דמי קאמפ</span></a>
          <div class="divider"></div>
          <a class="menuitem" href="Foundations.dc.html">${icon('plus')}<span>שנה חדשה</span></a>
          <div class="menusect" style="padding-bottom: 10px; line-height: 1.4;">חשבונות, אנשים וחובות בלי שנה נשארים גלויים בכל שנה.</div>
        </div>
      </div>
    </sc-if>
    <sc-if value="{{ searchOpen }}" hint-placeholder-val="{{ false }}">
      <div>
        <button class="scrim" type="button" aria-label="סגירה" onClick="{{ closeOverlays }}" style="border: 0; padding: 0;"></button>
        <div class="pop" style="top: 110px; left: 50%; transform: translateX(-50%); width: 620px; z-index: 40;">
          <div style="display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line);">
            ${icon('search', 18)}
            <span style="flex: 1; font-size: 15px;">רו<span style="border-inline-end: 1.5px solid var(--brand); margin-inline-start: 1px;"></span></span>
            <span class="kbd">esc</span>
          </div>
          <div style="padding: 6px 0; max-height: 380px;">
            <div class="menusect">אנשים</div>
            <a class="menuitem" href="Person.dc.html"><span class="av sm c1">רא</span><span><b style="font-weight: 600;">רו</b>ני אדלר</span><span class="mi-meta">ראש/ת צוות · ברן 26 · חייבים לה 910 ₪</span></a>
            <a class="menuitem" href="People.dc.html"><span class="av sm c4">מר</span><span>מיכל <b style="font-weight: 600;">רו</b>זן</span><span class="mi-meta">חברה · ברן 26 · טרם שילמה</span></a>
            <div class="menusect">פעולות</div>
            <a class="menuitem" href="Dues.dc.html">${icon('receipt')}<span>רישום תשלום</span><span class="mi-meta">ת</span></a>
            <a class="menuitem" href="People.dc.html">${icon('userplus')}<span>הוספת אדם</span><span class="mi-meta">א</span></a>
            <a class="menuitem" href="Files.dc.html">${icon('upload')}<span>העלאת קובץ אקסל</span></a>
            <div class="menusect">מקורות</div>
            <a class="menuitem" href="Files.dc.html">${icon('grid')}<span>קופת קאמפ 2026 › תנועות קופה</span><span class="mi-meta src" style="height: auto;">A3:H61</span></a>
          </div>
          <div style="display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-top: 1px solid var(--line); background: var(--sunken); color: var(--ink-3); font-size: 12px;">
            <span>↑↓ ניווט</span><span>↵ פתיחה</span><span>esc סגירה</span>
            <span style="margin-inline-start: auto;">חיפוש על פני אנשים, תנועות, סעיפים וקבצים</span>
          </div>
        </div>
      </div>
    </sc-if>`;

function props(w, h, extra = {}) {
  return JSON.stringify({
    theme: { editor: 'enum', options: ['light', 'dark'], default: 'light', section: 'Theme' },
    density: { editor: 'enum', options: ['comfortable', 'compact'], default: 'comfortable', section: 'Theme' },
    ...extra,
    $preview: { width: w, height: h },
  });
}

const pagesDir = path.join(ROOT, 'src/pages');
const boards = {};
const order = [];
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/layout.json'), 'utf8'));

fs.rmSync(path.join(OUT, 'project'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'project'), { recursive: true });

for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.html')).sort()) {
  let src = fs.readFileSync(path.join(pagesDir, f), 'utf8');
  const m = src.match(/^<!--meta (\{.*?\}) -->\n/);
  if (!m) throw new Error(`${f}: missing meta header`);
  const meta = JSON.parse(m[1]);
  src = src.slice(m[0].length);
  const place = layout.boards[meta.file];
  if (!place) throw new Error(`${f}: no layout entry for ${meta.file}`);
  src = src
    .replace('<!--HEAD-->', HEAD)
    .replace('<!--SIDEBAR-->', () => sidebar(meta.nav))
    .replace('<!--OVERLAYS-->', () => OVERLAYS)
    .replace('/*SHELL*/', SHELL)
    .replace(/__PROPS__/g, () => props(meta.w, meta.h, meta.props || {}).replace(/'/g, '&#39;'))
    .replace(/__W__/g, String(meta.w))
    .replace(/__H__/g, String(meta.h))
    .replace(/\[\[i:([a-z]+)(?::(\d+))?\]\]/g, (_, n, s) => icon(n, s ? Number(s) : 16));
  if (/\[\[i:/.test(src)) throw new Error(`${f}: unresolved icon macro`);
  if (/<!--(HEAD|SIDEBAR)-->/.test(src)) throw new Error(`${f}: unresolved partial`);
  fs.writeFileSync(path.join(OUT, 'project', meta.file), src);
  boards[meta.file] = { x: place.x, y: place.y, w: meta.w, h: meta.h, title: meta.title, ...(meta.interactive ? { is_interactive: true } : {}) };
  order.push(meta.file);
}

order.sort((a, b) => (a === 'Main.dc.html' ? -1 : b === 'Main.dc.html' ? 1 : 0));
const canvas = {
  v: 3,
  createdOnFiles: { v: 1, at: layout.createdAt },
  title: 'Shliff CRM Redesign',
  launch: { view: 'canvas' },
  pages: [],
  boards,
  order,
  notes: layout.notes,
  designSystems: [],
};
fs.writeFileSync(path.join(OUT, 'project', 'canvas.json'), JSON.stringify(canvas, null, 2));
console.log('built', order.length, 'boards:', order.join(', '));
