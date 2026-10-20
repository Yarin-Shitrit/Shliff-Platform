import { formatDateFull, formatDateTime } from '@/lib/dates';
import { EVENT_CLOSES, EVENT_OPENS, formatWindow, type EventWindow } from './shift-time';
import type { Board, ScheduleSlot } from './shifts';

/**
 * The schedule as a sheet of paper.
 *
 * A complete HTML document rather than a page in the app: the admin shell
 * — rail, tab bar, top bar — belongs to every screen and is not this
 * screen's to hide, and a printed board needs none of it. The route handler
 * returns this string as `text/html`, the browser opens it in a tab of its
 * own, and the first thing the document does is ask to print. Cancelling
 * leaves it on screen to read.
 *
 * Pure, so a test can assert what is on the sheet without a browser: every
 * name, every window, and no English — the people reading it in the dust
 * are the camp.
 */

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slotHtml(slot: ScheduleSlot): string {
  const names = slot.assignees
    .filter((assignee) => assignee.status === 'accepted' || assignee.status === 'done')
    .map((assignee) => `<li>${escape(assignee.displayName)}</li>`);
  const open = Math.max(0, slot.peopleNeeded - names.length);
  for (let index = 0; index < open; index += 1) names.push('<li class="open">— פנוי —</li>');
  return `<div class="slot${slot.uncovered ? ' short' : ''}">`
    + `<div class="when">${escape(formatWindow(slot.startsAt, slot.endsAt))}</div>`
    + `<ul>${names.join('')}</ul>`
    + '</div>';
}

export function schedulePrintHtml(input: {
  seasonName: string;
  window: EventWindow;
  board: Board;
  printedAt: Date;
}): string {
  const { seasonName, window, board, printedAt } = input;
  const head = window.days
    .map((day) => `<th><div class="weekday">${escape(day.weekday)}</div><div class="date">${escape(day.dayMonth)}</div></th>`)
    .join('');
  const rows = board.rows.map((row) => {
    const label = row.type === null ? 'ללא סוג' : row.type.name;
    const cells = row.cells.map((cell) => `<td>${cell.map(slotHtml).join('')}</td>`).join('');
    return `<tr><th scope="row">${escape(label)}</th>${cells}</tr>`;
  }).join('');
  const body = board.rows.length === 0
    ? '<p class="empty">עדיין אין משמרות בלוח.</p>'
    : `<table><thead><tr><th>משמרת</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  const outside = board.outside.length === 0 ? '' : `<section class="outside"><h2>מחוץ לימי האירוע</h2><ul>${
    board.outside.map((slot) => `<li>${escape(slot.title)} · ${escape(formatDateTime(slot.startsAt))}</li>`).join('')
  }</ul></section>`;

  const subtitle = `${escape(window.days[0].weekday)} ${escape(formatDateFull(window.startsAt))} ${EVENT_OPENS.clock}`
    + ` עד ${escape(window.days[EVENT_CLOSES.dayOffset].weekday)} ${escape(formatDateFull(window.endsAt))} ${EVENT_CLOSES.clock}`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>לוח משמרות · ${escape(seasonName)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #111; background: #fff; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-block-end: 12px; }
  h1 { margin: 0; font-size: 22px; }
  .sub { margin: 4px 0 0; color: #444; font-size: 13px; }
  .printed { color: #666; font-size: 11px; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #999; border-radius: 8px; background: #f5f5f5; cursor: pointer; }
  table { inline-size: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 6px; vertical-align: top; text-align: start; }
  thead th { background: #eee; font-size: 13px; }
  tbody th { inline-size: 14%; background: #f7f7f7; font-size: 14px; }
  .weekday { font-weight: 600; }
  .date { font-weight: 400; color: #555; font-size: 12px; direction: ltr; }
  .slot { margin-block-end: 8px; padding: 4px 6px; border: 1px solid #ccc; border-radius: 6px; break-inside: avoid; }
  .slot.short { border-color: #b45309; }
  .when { font-weight: 600; font-size: 12px; direction: ltr; text-align: start; }
  .slot ul { margin: 4px 0 0; padding-inline-start: 16px; font-size: 12px; }
  .open { color: #b45309; list-style: none; margin-inline-start: -16px; }
  .empty { color: #555; }
  .outside { margin-block-start: 16px; font-size: 13px; }
  .outside h2 { font-size: 14px; margin: 0 0 4px; }
  @media print { button { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>לוח משמרות · ${escape(seasonName)}</h1>
    <p class="sub">${subtitle}</p>
  </div>
  <div>
    <button type="button" onclick="window.print()">הדפסה</button>
    <div class="printed">הודפס ${escape(formatDateTime(printedAt))}</div>
  </div>
</header>
${body}
${outside}
<script>window.addEventListener('load', function () { window.print(); });</script>
</body>
</html>
`;
}
