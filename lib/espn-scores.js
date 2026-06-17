/**
 * Fetch FIFA World Cup scores from ESPN's public API and map them
 * onto our matches.json records.
 *
 * No API key required. Used by scripts/sync-scores.js and functions/api/scores.js.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

/** ESPN display names → names used in matches.json */
export const ESPN_TEAM_ALIASES = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Congo DR': 'DR Congo',
  'Ivory Coast': "Côte d'Ivoire",
  'Korea Republic': 'South Korea',
  USA: 'United States',
};

const PLACEHOLDER_RE = /group|winner|third place|round of|runner-up|runners-up|2nd place|1st place/i;

function canonicalTeam(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  return ESPN_TEAM_ALIASES[trimmed] || trimmed;
}

function normalizeKey(name) {
  return canonicalTeam(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isRealTeam(name) {
  return name && !PLACEHOLDER_RE.test(name);
}

function pairKey(teamA, teamB) {
  const a = normalizeKey(teamA);
  const b = normalizeKey(teamB);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function kickoffMs(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function utcDateKey(iso) {
  const ms = kickoffMs(iso);
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function mapEspnStatus(type = {}) {
  const state = String(type.state || '').toLowerCase();
  const name = String(type.name || '').toLowerCase();
  if (state === 'in' || name.includes('in_progress') || name.includes('halftime')) {
    return 'live';
  }
  if (state === 'post' || name.includes('full_time') || name.includes('final') || name.includes('penalt')) {
    return 'final';
  }
  return 'upcoming';
}

function parseEspnEvent(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeTeam = canonicalTeam(home.team?.displayName);
  const awayTeam = canonicalTeam(away.team?.displayName);
  if (!isRealTeam(homeTeam) || !isRealTeam(awayTeam)) return null;

  const status = mapEspnStatus(comp.status?.type);
  const homeScore = home.score != null && home.score !== '' ? Number(home.score) : null;
  const awayScore = away.score != null && away.score !== '' ? Number(away.score) : null;

  return {
    kickoffUtc: event.date,
    kickoffMs: kickoffMs(event.date),
    dateKey: utcDateKey(event.date),
    homeTeam,
    awayTeam,
    pairKey: pairKey(homeTeam, awayTeam),
    status,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    espnId: event.id,
  };
}

/**
 * @param {string} startDate YYYYMMDD
 * @param {string} endDate YYYYMMDD
 */
export async function fetchEspnEvents(startDate, endDate) {
  const url = `${ESPN_BASE}?dates=${startDate}-${endDate}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const json = await res.json();
  return (json.events || []).map(parseEspnEvent).filter(Boolean);
}

function indexEspnEvents(events) {
  const byPairDate = new Map();
  const byPair = new Map();

  for (const ev of events) {
    if (ev.dateKey) {
      const key = `${ev.pairKey}|${ev.dateKey}`;
      if (!byPairDate.has(key)) byPairDate.set(key, []);
      byPairDate.get(key).push(ev);
    }
    if (!byPair.has(ev.pairKey)) byPair.set(ev.pairKey, []);
    byPair.get(ev.pairKey).push(ev);
  }

  for (const list of byPairDate.values()) list.sort((a, b) => a.kickoffMs - b.kickoffMs);
  for (const list of byPair.values()) list.sort((a, b) => a.kickoffMs - b.kickoffMs);

  return { byPairDate, byPair };
}

function pickEspnEvent(ourMatch, index) {
  const teamA = canonicalTeam(ourMatch.teamA);
  const teamB = canonicalTeam(ourMatch.teamB);
  if (!isRealTeam(teamA) || !isRealTeam(teamB)) return null;

  const pk = pairKey(teamA, teamB);
  const ourMs = kickoffMs(ourMatch.kickoffUtc);
  const dateKey = utcDateKey(ourMatch.kickoffUtc);

  const candidates = (dateKey && index.byPairDate.get(`${pk}|${dateKey}`)) || index.byPair.get(pk) || [];
  if (!candidates.length) return null;

  if (ourMs == null) return candidates[0];

  let best = candidates[0];
  let bestDelta = Math.abs(candidates[0].kickoffMs - ourMs);
  for (const c of candidates.slice(1)) {
    const delta = Math.abs(c.kickoffMs - ourMs);
    if (delta < bestDelta) {
      best = c;
      bestDelta = delta;
    }
  }

  // Allow up to 3 hours drift (schedule tweaks / timezone quirks).
  if (bestDelta > 3 * 60 * 60 * 1000) return null;
  return best;
}

function scoresForMatch(ourMatch, espnEvent) {
  const teamA = canonicalTeam(ourMatch.teamA);
  const teamB = canonicalTeam(ourMatch.teamB);

  let scoreA = null;
  let scoreB = null;

  if (normalizeKey(teamA) === normalizeKey(espnEvent.homeTeam)) {
    scoreA = espnEvent.homeScore;
    scoreB = espnEvent.awayScore;
  } else if (normalizeKey(teamA) === normalizeKey(espnEvent.awayTeam)) {
    scoreA = espnEvent.awayScore;
    scoreB = espnEvent.homeScore;
  }

  if (espnEvent.status === 'upcoming') {
    return { scoreA: null, scoreB: null };
  }

  return { scoreA, scoreB };
}

function shouldApply(current, next) {
  const curStatus = String(current.status || 'upcoming').toLowerCase();
  const nextStatus = String(next.status || 'upcoming').toLowerCase();

  if (curStatus === 'final' && nextStatus !== 'final') return false;
  if (nextStatus === 'upcoming' && curStatus !== 'upcoming') return false;
  if (next.status === current.status && next.scoreA === current.scoreA && next.scoreB === current.scoreB) {
    return false;
  }
  return true;
}

/**
 * Build score updates for World Cup matches in our schedule.
 * @param {Array<object>} ourMatches
 * @param {Array<object>} espnEvents parsed ESPN events
 */
export function buildScoreUpdates(ourMatches, espnEvents) {
  const index = indexEspnEvents(espnEvents);
  const updates = [];

  for (const match of ourMatches) {
    if (!/fifa world cup 2026/i.test(match.competition || '')) continue;

    const espn = pickEspnEvent(match, index);
    if (!espn) continue;

    const { scoreA, scoreB } = scoresForMatch(match, espn);
    const patch = {
      id: match.id,
      status: espn.status,
      scoreA: espn.status === 'upcoming' ? null : scoreA,
      scoreB: espn.status === 'upcoming' ? null : scoreB,
    };

    if (shouldApply(match, patch)) updates.push(patch);
  }

  return updates;
}

/** Apply updates in-place; returns number of changed matches. */
export function applyScoreUpdates(matches, updates) {
  let changed = 0;
  const byId = new Map(matches.map((m) => [m.id, m]));

  for (const patch of updates) {
    const match = byId.get(patch.id);
    if (!match || !shouldApply(match, patch)) continue;
    match.status = patch.status;
    match.scoreA = patch.scoreA;
    match.scoreB = patch.scoreB;
    changed += 1;
  }

  return changed;
}

/** Date range: 3 days back through tomorrow (UTC). Good for live API polling. */
export function defaultDateRange(now = new Date()) {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 3);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);

  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return { startDate: fmt(start), endDate: fmt(end) };
}

/** Full World Cup 2026 window — used when writing matches.json to disk. */
export function tournamentDateRange() {
  return { startDate: '20260611', endDate: '20260720' };
}

export async function fetchScoreUpdates(ourMatches, range, now = new Date()) {
  const events = await fetchEspnEvents(range.startDate, range.endDate);
  const updates = buildScoreUpdates(ourMatches, events);
  return {
    updatedAt: now.toISOString(),
    source: 'espn',
    updates,
    eventCount: events.length,
  };
}

export async function fetchLiveScoreUpdates(ourMatches, now = new Date()) {
  return fetchScoreUpdates(ourMatches, defaultDateRange(now), now);
}

export async function fetchTournamentScoreUpdates(ourMatches, now = new Date()) {
  return fetchScoreUpdates(ourMatches, tournamentDateRange(), now);
}