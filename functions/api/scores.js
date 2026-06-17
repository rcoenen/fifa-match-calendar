import {
  buildScoreUpdates,
  defaultDateRange,
  fetchEspnEvents,
} from '../../lib/espn-scores.js';

const WC_RE = /fifa world cup 2026/i;

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;

  try {
    const [matchesRes, range] = await Promise.all([
      fetch(`${origin}/matches.json`, { cf: { cacheTtl: 30 } }),
      Promise.resolve(defaultDateRange()),
    ]);

    if (!matchesRes.ok) {
      return json({ error: 'Could not load matches.json' }, 502);
    }

    const raw = await matchesRes.json();
    const matches = Array.isArray(raw) ? raw : raw.matches || [];
    const events = await fetchEspnEvents(range.startDate, range.endDate);
    const updates = buildScoreUpdates(matches, events);

    return json(
      {
        updatedAt: new Date().toISOString(),
        source: 'espn',
        updates,
      },
      200,
      {
        'Cache-Control': 'public, max-age=15',
        'Access-Control-Allow-Origin': '*',
      },
    );
  } catch (err) {
    return json({ error: err.message || 'Score sync failed' }, 500);
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}