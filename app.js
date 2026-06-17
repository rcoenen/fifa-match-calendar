/* ============================================================
   FIFA Match Calendar — app.js
   Plain JavaScript. No framework, no build step.

   How it works, top to bottom:
     1. Load match data: fetch("matches.json"); if the browser
        blocks that (it happens on file:// pages), fall back to
        the copy embedded in index.html.
     2. Keep a tiny state object: { tzKey, filter, query }.
     3. render(): filter matches, group them by day *in the
        active timezone*, and rebuild the schedule list.

   Every date/time on screen goes through Intl.DateTimeFormat
   with an IANA timezone name ("America/New_York"). There are no
   hardcoded UTC offsets, so daylight saving time is handled by
   the browser automatically.
   ============================================================ */

'use strict';

/* ---------- Timezone configuration ----------
   `id` is an IANA timezone passed to Intl.DateTimeFormat.
   `undefined` means "use the visitor's own timezone".
   New York is ALWAYS the default (see `state` below). */
const TIMEZONES = {
  ny:    { id: 'America/New_York', note: 'Times shown in New York time',  copyLabel: 'New York time' },
  local: { id: undefined,          note: 'Times shown in your local time', copyLabel: 'local time' },
  utc:   { id: 'UTC',              note: 'Times shown in UTC',             copyLabel: 'UTC' },
};

// Length of the calendar event created by "Add to calendar".
const MATCH_DURATION_MINUTES = 120;

/* ---------- Country flags ----------
   Team name → ISO country code, used to build a small flag image
   (https://flagcdn.com/<code>.svg). Lookups ignore case, accents and
   punctuation, so "Côte d'Ivoire" and "Cote dIvoire" both match.
   Teams that aren't listed simply get no flag — nothing breaks.
   Add a line here when you add a new team to matches.json. */
const TEAM_FLAGS = {
  // North & Central America, Caribbean
  'United States': 'us', 'USA': 'us', 'Mexico': 'mx', 'Canada': 'ca', 'Panama': 'pa',
  'Costa Rica': 'cr', 'Honduras': 'hn', 'Jamaica': 'jm', 'Haiti': 'ht', 'Curaçao': 'cw',
  'El Salvador': 'sv', 'Guatemala': 'gt', 'Suriname': 'sr', 'Trinidad and Tobago': 'tt',
  // South America
  'Argentina': 'ar', 'Brazil': 'br', 'Uruguay': 'uy', 'Paraguay': 'py', 'Colombia': 'co',
  'Ecuador': 'ec', 'Chile': 'cl', 'Peru': 'pe', 'Venezuela': 've', 'Bolivia': 'bo',
  // Europe
  'England': 'gb-eng', 'Scotland': 'gb-sct', 'Wales': 'gb-wls', 'Northern Ireland': 'gb-nir',
  'France': 'fr', 'Germany': 'de', 'Spain': 'es', 'Portugal': 'pt', 'Netherlands': 'nl',
  'Belgium': 'be', 'Italy': 'it', 'Croatia': 'hr', 'Switzerland': 'ch', 'Austria': 'at',
  'Denmark': 'dk', 'Sweden': 'se', 'Norway': 'no', 'Poland': 'pl', 'Czechia': 'cz',
  'Czech Republic': 'cz', 'Serbia': 'rs', 'Türkiye': 'tr', 'Turkey': 'tr', 'Ukraine': 'ua',
  'Republic of Ireland': 'ie', 'Ireland': 'ie', 'Greece': 'gr', 'Hungary': 'hu',
  'Romania': 'ro', 'Slovakia': 'sk', 'Slovenia': 'si', 'Albania': 'al',
  'Bosnia and Herzegovina': 'ba', 'North Macedonia': 'mk', 'Iceland': 'is', 'Finland': 'fi',
  'Kosovo': 'xk',
  // Africa
  'Morocco': 'ma', 'Senegal': 'sn', 'Tunisia': 'tn', 'Algeria': 'dz', 'Egypt': 'eg',
  'Nigeria': 'ng', 'Ghana': 'gh', 'Cameroon': 'cm', "Côte d'Ivoire": 'ci', 'Ivory Coast': 'ci',
  'South Africa': 'za', 'Mali': 'ml', 'Burkina Faso': 'bf', 'Cape Verde': 'cv', 'Cabo Verde': 'cv',
  'DR Congo': 'cd', 'Zambia': 'zm', 'Gabon': 'ga',
  // Asia & Oceania
  'Japan': 'jp', 'South Korea': 'kr', 'Korea Republic': 'kr', 'Australia': 'au',
  'Iran': 'ir', 'IR Iran': 'ir', 'Saudi Arabia': 'sa', 'Qatar': 'qa', 'Iraq': 'iq',
  'United Arab Emirates': 'ae', 'UAE': 'ae', 'Jordan': 'jo', 'Uzbekistan': 'uz',
  'Oman': 'om', 'Bahrain': 'bh', 'China PR': 'cn', 'China': 'cn', 'Indonesia': 'id',
  'Thailand': 'th', 'Vietnam': 'vn', 'New Zealand': 'nz', 'New Caledonia': 'nc',
  // Friendly opponents (not World Cup qualified)
  'Bermuda': 'bm', 'Aruba': 'aw', 'Nicaragua': 'ni', 'Puerto Rico': 'pr',
  'Dominican Republic': 'do', 'Madagascar': 'mg', 'Gambia': 'gm', 'The Gambia': 'gm',
  'Andorra': 'ad', 'Russia': 'ru', 'Burundi': 'bi',
};

// Same map, but keyed by normalized name for forgiving lookups.
const FLAG_LOOKUP = new Map(
  Object.entries(TEAM_FLAGS).map(([name, code]) => [normalizeTeamKey(name), code])
);

/* ---------- UI state ---------- */
const state = {
  tzKey: 'ny',    // 'ny' | 'local' | 'utc'
  filter: 'all',  // 'all' | 'today' | 'tomorrow' | 'week' | 'results'
  query: '',      // current search text
  team: null,     // exact team name — set by tapping a team on any card
};

let matches = [];     // normalized matches, sorted by kickoff time
let updatedAt = null; // Date parsed from matches.json "updatedAt", if present
let loadedAt = null;  // Date when the data was loaded (fallback timestamp)
let dataSource = '';  // where the data came from, shown in the footer

/* ---------- Element lookups ---------- */
const $ = (selector) => document.querySelector(selector);
const els = {
  tzNote: $('#tz-note'),
  schedule: $('#schedule'),
  empty: $('#empty'),
  resultLine: $('#result-line'),
  updatedLine: $('#updated-line'),
  search: $('#search'),
  reset: $('#reset-filters'),
  teamBar: $('#team-bar'),
  teamBarLabel: $('#team-bar-label'),
  teamClear: $('#team-clear'),
  filterButtons: [...document.querySelectorAll('button[data-filter]')],
  tzButtons: [...document.querySelectorAll('button[data-tz]')],
};

/* ============================================================
   Date & time formatting (all timezone-aware)
   ============================================================ */

// Cache Intl formatters — they are expensive to create.
const formatterCache = new Map();
function fmt(options, locale = 'en-US') {
  const tz = TIMEZONES[state.tzKey].id;
  const key = `${tz || 'local'}|${locale}|${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }));
  }
  return formatterCache.get(key);
}

// "3:00 PM"
const formatTime = (date) => fmt({ hour: 'numeric', minute: '2-digit' }).format(date);

// "Thursday, June 11" — the year is added only when it differs from the current year.
function formatDayHeading(date) {
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  const yearOf = (d) => fmt({ year: 'numeric' }).format(d);
  if (yearOf(date) !== yearOf(new Date())) opts.year = 'numeric';
  return fmt(opts).format(date);
}

// "Thu Jun 11" — used by the Copy button.
const formatShortDay = (date) =>
  fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(date).replace(',', '');

// "2026-06-11" in the ACTIVE timezone (en-CA formats as YYYY-MM-DD).
// This key is what groups matches into days and powers the date filters,
// so a 1:00 AM UTC kickoff correctly lands on the previous evening in New York.
const dayKey = (date) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(date);

// Day key for "today + n days" in the active timezone.
const dayKeyWithOffset = (days) => dayKey(new Date(Date.now() + days * 86_400_000));

/* ============================================================
   Data loading
   ============================================================ */

async function loadData() {
  try {
    // cache: "no-store" so an updated matches.json shows up immediately after deploy.
    const res = await fetch('matches.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyData(await res.json(), 'matches.json');
  } catch (err) {
    // Browsers block fetch() on file:// pages. Use the copy embedded in
    // index.html so double-clicking the file still works.
    const fallback = document.getElementById('fallback-data');
    if (fallback) {
      applyData(JSON.parse(fallback.textContent), 'built-in copy (run a local server to load matches.json)');
    } else {
      els.schedule.innerHTML =
        '<p class="load-error">Could not load <code>matches.json</code>. ' +
        'If you opened this file directly, try a local server: <code>python3 -m http.server</code></p>';
      console.error('Failed to load match data:', err);
    }
  }
}

// Accepts both supported shapes:
//   1. a plain array of matches            → no "last updated" value
//   2. { "updatedAt": "...", "matches": [...] }
function applyData(json, source) {
  const rows = Array.isArray(json) ? json : (json.matches || []);
  updatedAt = !Array.isArray(json) && json.updatedAt ? new Date(json.updatedAt) : null;
  if (updatedAt && Number.isNaN(updatedAt.getTime())) updatedAt = null;
  loadedAt = new Date();
  dataSource = source;

  matches = rows
    .map((m, i) => {
      // "2026-06-06" (date only, no confirmed kickoff time) is allowed.
      // It is anchored to noon UTC so it groups under the same calendar
      // day in every timezone, and the card shows no clock time.
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(m.kickoffUtc || '');
      return {
        ...m,
        id: m.id || `match-${i + 1}`,
        dateOnly,
        kickoff: new Date(dateOnly ? `${m.kickoffUtc}T12:00:00Z` : m.kickoffUtc),
        // Pre-built lowercase, accent-free text blob for the search box.
        haystack: searchable(
          [m.teamA, m.teamB, `${m.teamA} vs ${m.teamB}`, m.city, m.venue, m.competition, m.stage]
            .filter(Boolean)
            .join(' ')
        ),
      };
    })
    .filter((m) => !Number.isNaN(m.kickoff.getTime())) // drop rows with a bad kickoffUtc
    .sort((a, b) => a.kickoff - b.kickoff);             // ascending kickoff time
}

// Lowercase + strip accents, so searching "cote" finds "Côte d'Ivoire".
// (NFD splits "ô" into "o" + a combining accent; the regex removes the accents.)
function searchable(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Key used for flag lookups: lowercase, no accents, punctuation \u2192 spaces.
function normalizeTeamKey(name) {
  return searchable(name).replace(/[^a-z0-9]+/g, ' ').trim();
}

// Small flag <img> for a team, or '' when the team isn't in TEAM_FLAGS.
// alt="" because the flag is decorative \u2014 the team name sits right next to it.
function flagHtml(teamName) {
  const code = FLAG_LOOKUP.get(normalizeTeamKey(teamName));
  if (!code) return '';
  return `<img class="flag" src="https://flagcdn.com/${code}.svg" alt="" width="28" height="19" loading="lazy">`;
}

// Emoji flag (\ud83c\udde9\ud83c\uddea) for calendar invites \u2014 .ics files are plain text, so
// image flags can't be used there. Returns '' for unmapped teams and for
// flags that have no emoji (e.g. Northern Ireland).
function flagEmoji(teamName) {
  const code = FLAG_LOOKUP.get(normalizeTeamKey(teamName));
  if (!code) return '';
  // England / Scotland / Wales use emoji "tag sequences", not letter pairs.
  const tagged = { 'gb-eng': 'gbeng', 'gb-sct': 'gbsct', 'gb-wls': 'gbwls' }[code];
  if (tagged) {
    return '\u{1F3F4}' +
      [...tagged].map((c) => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('') +
      '\u{E007F}';
  }
  if (code.length !== 2) return '';
  // "de" \u2192 \ud83c\udde9 + \ud83c\uddea (regional indicator letters combine into one flag)
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

/* ============================================================
   Filtering & grouping
   ============================================================ */

function getVisibleMatches() {
  const todayKey = dayKeyWithOffset(0);
  const tomorrowKey = dayKeyWithOffset(1);
  const weekEndKey = dayKeyWithOffset(6); // today + 6 = a 7-day window
  const query = searchable(state.query);

  return matches.filter((m) => {
    const key = dayKey(m.kickoff);
    if (state.filter === 'today' && key !== todayKey) return false;
    if (state.filter === 'tomorrow' && key !== tomorrowKey) return false;
    if (state.filter === 'week' && (key < todayKey || key > weekEndKey)) return false;
    if (state.filter === 'results' && !isFinished(m)) return false;
    // Team filter is an exact match, so "Mexico" doesn't also catch
    // every game played in Mexico City the way a text search would.
    if (state.team && m.teamA !== state.team && m.teamB !== state.team) return false;
    if (query && !m.haystack.includes(query)) return false;
    return true; // "all" hides nothing — past matches stay visible
  });
}

function statusInfo(match) {
  const s = String(match.status || '').toLowerCase();
  if (s === 'live') return { label: 'Live', cls: 'live' };
  if (isFinished(match)) return { label: 'Final', cls: 'final' };
  if (s && s !== 'upcoming') return { label: match.status, cls: 'other' }; // e.g. "Postponed"
  return { label: 'Upcoming', cls: 'upcoming' };
}

// A score of 0 is valid, so check against null/undefined — not truthiness.
const hasScore = (m) => m.scoreA != null && m.scoreB != null;

// Statuses that mean "this match is over" (powers the Results filter).
const FINISHED_STATUSES = ['final', 'finished', 'ft', 'full-time'];
const isFinished = (m) => FINISHED_STATUSES.includes(String(m.status || '').toLowerCase());

// Friendlies get their own amber tag so they're never mistaken
// for tournament matches. Detected from the competition/stage text.
const isFriendly = (m) => /friendly/i.test(`${m.competition || ''} ${m.stage || ''}`);

/* ============================================================
   Rendering
   ============================================================ */

// Escape text before inserting it into HTML.
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const ICON_CALENDAR =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M12 14v5M9.5 16.5h5"/></svg>';
const ICON_COPY =
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function matchCardHtml(match) {
  const status = statusInfo(match);

  // Between the team names: "vs" for unplayed matches, the score otherwise.
  const middle = hasScore(match)
    ? `<span class="score">${esc(match.scoreA)}<span class="score-dash">–</span>${esc(match.scoreB)}</span>`
    : '<span class="vs">vs</span>';

  const competitionLine = [match.competition, match.stage].filter(Boolean).join(' · ');
  const placeLine = [match.venue, match.city].filter(Boolean).join(', ');

  const friendlyTag = isFriendly(match) ? '<span class="tag-friendly">Friendly</span>' : '';

  return `
    <li class="card${status.cls === 'live' ? ' is-live' : ''}">
      <div class="card-top">
        <span class="time">${match.dateOnly ? '' : esc(formatTime(match.kickoff))}</span>
        <span class="badges">${friendlyTag}<span class="badge badge-${status.cls}">${esc(status.label)}</span></span>
      </div>
      <p class="teams">
        <button type="button" class="team" data-team="${esc(match.teamA)}" aria-label="Show all ${esc(match.teamA)} matches">${flagHtml(match.teamA)}${esc(match.teamA)}</button>${middle}<button type="button" class="team" data-team="${esc(match.teamB)}" aria-label="Show all ${esc(match.teamB)} matches">${flagHtml(match.teamB)}${esc(match.teamB)}</button>
      </p>
      ${competitionLine ? `<p class="meta">${esc(competitionLine)}</p>` : ''}
      ${placeLine ? `<p class="meta meta-place">${esc(placeLine)}</p>` : ''}
      <div class="card-actions">
        <button class="btn" type="button" data-action="calendar" data-id="${esc(match.id)}">
          ${ICON_CALENDAR}<span>Add to calendar</span>
        </button>
        <button class="btn" type="button" data-action="copy" data-id="${esc(match.id)}">
          ${ICON_COPY}<span>Copy</span>
        </button>
      </div>
    </li>`;
}

function render() {
  // Header note + pressed states for the toggle buttons.
  els.tzNote.textContent = tzNoteText();
  els.filterButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
  els.tzButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tz === state.tzKey)));

  const visible = getVisibleMatches();

  // Group by day key. `matches` is already sorted, so groups stay in order.
  const groups = new Map();
  for (const m of visible) {
    const key = dayKey(m.kickoff);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const todayKey = dayKeyWithOffset(0);
  const tomorrowKey = dayKeyWithOffset(1);

  let html = '';
  for (const [key, dayMatches] of groups) {
    const pill =
      key === todayKey ? '<span class="day-pill">Today</span>'
      : key === tomorrowKey ? '<span class="day-pill is-soft">Tomorrow</span>'
      : '';
    html += `
      <section class="day" data-day="${esc(key)}">
        <h2 class="day-head">
          <span class="day-name">${esc(formatDayHeading(dayMatches[0].kickoff))}</span>${pill}
          <span class="day-count">${dayMatches.length} ${dayMatches.length === 1 ? 'match' : 'matches'}</span>
        </h2>
        <ul class="match-list">${dayMatches.map(matchCardHtml).join('')}</ul>
      </section>`;
  }

  els.schedule.innerHTML = html;
  els.empty.hidden = visible.length > 0;
  els.resultLine.textContent = `${visible.length} ${visible.length === 1 ? 'match' : 'matches'}`;

  // Selected-team pill in the sticky bar
  if (state.team) {
    els.teamBar.hidden = false;
    els.teamBarLabel.innerHTML =
      `${flagHtml(state.team)}<strong>${esc(state.team)}</strong><span class="team-bar-note">all matches</span>`;
  } else {
    els.teamBar.hidden = true;
  }

  renderUpdatedLine();
}

function tzNoteText() {
  if (state.tzKey === 'local') {
    // Tell the visitor which zone "local" resolved to, e.g. "Europe/Amsterdam".
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `Times shown in your local time (${zone})`;
  }
  return TIMEZONES[state.tzKey].note;
}

function renderUpdatedLine() {
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const label = TIMEZONES[state.tzKey].copyLabel;
  if (updatedAt) {
    els.updatedLine.textContent = `Schedule last updated ${fmt(opts).format(updatedAt)} (${label}).`;
  } else if (loadedAt) {
    els.updatedLine.textContent = `Data loaded ${fmt(opts).format(loadedAt)} (${label}).`;
  }
  if (dataSource && dataSource !== 'matches.json') {
    els.updatedLine.textContent += ` Source: ${dataSource}.`;
  }
}

/* ============================================================
   "Add to calendar" — builds and downloads a tiny .ics file
   ============================================================ */

function icsForMatch(match) {
  // .ics times are stored in UTC ("Z" suffix); every calendar app then
  // shows the event in whatever timezone the device is set to.
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escapeIcs = (t) =>
    String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  const end = new Date(match.kickoff.getTime() + MATCH_DURATION_MINUTES * 60_000);
  const location = [match.venue, match.city].filter(Boolean).join(', ');
  const description = [match.competition, match.stage].filter(Boolean).join(' · ');

  // "🇩🇪 Germany" — emoji flag + name for the event title.
  const withFlag = (name) => {
    const flag = flagEmoji(name);
    return flag ? `${flag} ${name}` : name;
  };

  // Matches without a confirmed kickoff time become all-day events.
  const timing = match.dateOnly
    ? [
        `DTSTART;VALUE=DATE:${match.kickoffUtc.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${new Date(match.kickoff.getTime() + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')}`,
      ]
    : [`DTSTART:${stamp(match.kickoff)}`, `DTEND:${stamp(end)}`];

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FIFA Match Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${match.id}@fifa-match-calendar`,
    `DTSTAMP:${stamp(new Date())}`,
    ...timing,
    `SUMMARY:${escapeIcs(`${withFlag(match.teamA)} vs ${withFlag(match.teamB)}`)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function downloadIcs(match) {
  const slug = (t) => searchable(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'match';
  const blob = new Blob([icsForMatch(match)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(match.teamA)}-vs-${slug(match.teamB)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   "Copy" — e.g. "Mexico vs South Africa, Thu Jun 11, 3:00 PM New York time"
   ============================================================ */

function matchCopyText(match) {
  const day = formatShortDay(match.kickoff);
  // Finished match → lead with the result: "United States 1–2 Germany, Sat Jun 6"
  const teams = isFinished(match) && hasScore(match)
    ? `${match.teamA} ${match.scoreA}–${match.scoreB} ${match.teamB}`
    : `${match.teamA} vs ${match.teamB}`;
  if (match.dateOnly) return `${teams}, ${day}`;
  return `${teams}, ${day}, ${formatTime(match.kickoff)} ${TIMEZONES[state.tzKey].copyLabel}`;
}

async function copyMatch(match, button) {
  const text = matchCopyText(match);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacyCopy(text); // clipboard API needs https; this covers file:// and older browsers
  }
  flashButton(button, ok ? 'Copied!' : 'Copy failed');
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

// Briefly swap a button's label to confirm the action, then restore it.
function flashButton(button, message) {
  if (button.dataset.original == null) button.dataset.original = button.innerHTML;
  button.innerHTML = `<span>${esc(message)}</span>`;
  button.classList.add('is-flash');
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.innerHTML = button.dataset.original;
    button.classList.remove('is-flash');
  }, 1600);
}

/* ============================================================
   Events & boot
   ============================================================ */

function wireControls() {
  els.filterButtons.forEach((b) =>
    b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); })
  );
  els.tzButtons.forEach((b) =>
    b.addEventListener('click', () => { state.tzKey = b.dataset.tz; render(); })
  );

  // Small debounce so we don't re-render on every keystroke.
  let timer;
  els.search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = els.search.value.trim();
      render();
    }, 120);
  });

  // One listener handles every card's buttons (cards are re-rendered often).
  els.schedule.addEventListener('click', (event) => {
    // Tapping a team name shows that team's full schedule.
    const teamButton = event.target.closest('button[data-team]');
    if (teamButton) {
      state.team = teamButton.dataset.team;
      state.filter = 'all';
      state.query = '';
      els.search.value = '';
      render();
      window.scrollTo(0, 0);
      return;
    }

    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const match = matches.find((m) => m.id === button.dataset.id);
    if (!match) return;
    if (button.dataset.action === 'calendar') downloadIcs(match);
    if (button.dataset.action === 'copy') copyMatch(match, button);
  });

  els.teamClear.addEventListener('click', () => {
    state.team = null;
    render();
  });

  // If a flag image fails to load (offline, CDN down), remove it so no
  // broken-image icon shows. Image errors don't bubble — capture phase.
  els.schedule.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) event.target.remove();
  }, true);

  els.reset.addEventListener('click', () => {
    state.filter = 'all';
    state.query = '';
    state.team = null;
    els.search.value = '';
    render();
  });
}

// On first load, jump past finished matches so today / the next kickoff
// is on screen (the results above stay reachable by scrolling up).
function scrollToUpcoming() {
  const todayKey = dayKeyWithOffset(0);
  const sections = [...document.querySelectorAll('.day')];
  const target = sections.find((s) => s.dataset.day >= todayKey);
  if (target && sections.indexOf(target) > 0) target.scrollIntoView();
}

(async function init() {
  wireControls();
  await loadData();
  render();
  scrollToUpcoming();
})();
