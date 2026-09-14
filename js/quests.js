// Quests: three rotating daily quests plus permanent milestones.
// Progress is computed from recorded data, so nothing needs manual input.
import { bus, ls, dayKey } from './util.js';
import { RARITY } from './stories.js';

const DAILY_POOL = [
  { id: 'd-explore', icon: '🌫️', title: 'Fog Breaker', desc: 'Reveal 300 new cells of map today', goal: 300, xp: 60, val: (c) => c.today.newCells },
  { id: 'd-collect3', icon: '💎', title: 'Collector', desc: 'Collect 3 places today', goal: 3, xp: 40, val: (c) => c.today.places.length },
  { id: 'd-history', icon: '🏛️', title: 'Time Traveler', desc: 'Collect a History place today', goal: 1, xp: 30, val: (c) => c.today.places.filter((p) => p.cat === 'history').length },
  { id: 'd-nature', icon: '🌲', title: 'Into the Wild', desc: 'Collect a Nature place today', goal: 1, xp: 30, val: (c) => c.today.places.filter((p) => p.cat === 'nature').length },
  { id: 'd-smooth', icon: '🥛', title: 'Steady Hands', desc: 'Finish a 3+ km drive with a smooth score of 90+', goal: 1, xp: 50, val: (c) => c.today.trips.filter((t) => t.meters > 3000 && t.score >= 90).length },
  { id: 'd-nospill', icon: '💧', title: 'Not a Drop', desc: 'Finish a 5+ km drive with zero spills', goal: 1, xp: 60, val: (c) => c.today.trips.filter((t) => t.meters > 5000 && t.spills === 0).length },
  { id: 'd-miles', icon: '🛣️', title: 'Road Warrior', desc: 'Drive 15 miles today', goal: 15, xp: 40, val: (c) => c.today.trips.reduce((s, t) => s + t.meters, 0) / 1609.344 },
  { id: 'd-town', icon: '🏘️', title: 'New Horizons', desc: 'Pass through a town you have never visited', goal: 1, xp: 50, val: (c) => c.today.newTowns },
  { id: 'd-rare', icon: '✨', title: 'Treasure Hunter', desc: 'Collect a Rare or Legendary place today', goal: 1, xp: 60, val: (c) => c.today.places.filter((p) => p.rarity !== 'common').length },
];

const MILESTONES = [
  { id: 'm-first', icon: '🚀', title: 'First Voyage', desc: 'Complete your first recorded drive', goal: 1, xp: 25, val: (c) => c.lifetime.trips },
  { id: 'm-10', icon: '💎', title: 'Curator', desc: 'Collect 10 places', goal: 10, xp: 50, val: (c) => c.places.length },
  { id: 'm-50', icon: '🗃️', title: 'Archivist', desc: 'Collect 50 places', goal: 50, xp: 150, val: (c) => c.places.length },
  { id: 'm-200', icon: '📚', title: 'Living Encyclopedia', desc: 'Collect 200 places', goal: 200, xp: 400, val: (c) => c.places.length },
  { id: 'm-legend', icon: '👑', title: 'Legend Found', desc: 'Collect a Legendary place', goal: 1, xp: 100, val: (c) => c.places.filter((p) => p.rarity === 'legendary').length },
  { id: 'm-allcats', icon: '🌈', title: 'Full Spectrum', desc: 'Collect a place in all 6 categories', goal: 6, xp: 150, val: (c) => new Set(c.places.map((p) => p.cat)).size },
  { id: 'm-km10', icon: '🗺️', title: 'Cartographer', desc: 'Explore 10 km² of map', goal: 10, xp: 150, val: (c) => c.areaKm2 },
  { id: 'm-km100', icon: '🌍', title: 'Trailblazer', desc: 'Explore 100 km² of map', goal: 100, xp: 600, val: (c) => c.areaKm2 },
  { id: 'm-towns', icon: '🏘️', title: 'Town Hopper', desc: 'Visit 20 towns', goal: 20, xp: 150, val: (c) => Object.keys(c.regions.towns).length },
  { id: 'm-counties', icon: '🧭', title: 'County Line', desc: 'Visit 5 counties', goal: 5, xp: 150, val: (c) => Object.keys(c.regions.counties).length },
  { id: 'm-states', icon: '🏳️', title: 'State Crosser', desc: 'Visit 3 states', goal: 3, xp: 250, val: (c) => Object.keys(c.regions.states).length },
  { id: 'm-streak', icon: '🔥', title: 'On a Roll', desc: 'Drive 7 days in a row', goal: 7, xp: 200, val: (c) => c.streak },
  { id: 'm-1000', icon: '🏁', title: 'Thousand Miler', desc: 'Drive 1,000 recorded miles', goal: 1000, xp: 500, val: (c) => c.lifetime.meters / 1609.344 },
  { id: 'm-zen', icon: '🧘', title: 'Zen Driver', desc: 'Finish a 15+ km drive with a smooth score of 98+', goal: 1, xp: 200, val: (c) => c.trips.filter((t) => t.meters > 15000 && t.score >= 98).length },
];

const TITLES = ['Rookie', 'Wanderer', 'Pathfinder', 'Navigator', 'Explorer', 'Cartographer', 'Trailblazer', 'Voyager', 'Legend'];

// Deterministic pick of 3 daily quests from the date.
function dailyFor(day) {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = [...DAILY_POOL];
  const out = [];
  while (out.length < 3) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

export class Quests {
  constructor() {
    this.done = ls.get('questsDone', {}); // key -> timestamp ("m-10" or "2026-09-14:d-miles")
  }

  context({ trips, stories, fog, place }) {
    const today = dayKey();
    const places = Object.values(stories.collection);
    const tripsToday = trips.trips.filter((t) => dayKey(t.start) === today);
    if (trips.current) tripsToday.push(trips.current);
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    return {
      places,
      trips: trips.trips,
      lifetime: trips.lifetime,
      streak: trips.streak(),
      areaKm2: fog.areaKm2,
      regions: place.regions,
      today: {
        places: places.filter((p) => dayKey(p.gotAt) === today),
        trips: tripsToday,
        newCells: tripsToday.reduce((s, t) => s + (t.newCells || 0), 0),
        newTowns: Object.values(place.regions.towns).filter((t) => t >= startOfDay).length,
      },
    };
  }

  evaluate(deps) {
    const c = this.context(deps);
    const day = dayKey();
    const map = (q, key) => {
      const value = Math.min(q.goal, q.val(c) || 0);
      return { ...q, key, value, pct: value / q.goal, complete: !!this.done[key] || value >= q.goal };
    };
    const daily = dailyFor(day).map((q) => map(q, `${day}:${q.id}`));
    const milestones = MILESTONES.map((q) => map(q, q.id));

    // Newly completed → persist + announce
    for (const q of [...daily, ...milestones]) {
      if (q.complete && !this.done[q.key]) {
        this.done[q.key] = Date.now();
        ls.set('questsDone', this.done);
        bus.emit('quest-complete', q);
      }
    }

    const questXp = [...DAILY_POOL, ...MILESTONES].reduce((s, q) => {
      const n = Object.keys(this.done).filter((k) => k === q.id || k.endsWith(':' + q.id)).length;
      return s + n * q.xp;
    }, 0);
    const placeXp = c.places.reduce((s, p) => s + (RARITY[p.rarity] || 10), 0);
    const xp = Math.round(questXp + placeXp + c.areaKm2 * 40 + (ls.get('quizXp', 0) || 0));
    const level = Math.floor(Math.sqrt(xp / 60)) + 1;
    const floor = 60 * (level - 1) ** 2;
    const next = 60 * level ** 2;
    return {
      daily, milestones, xp, level,
      title: TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 3))],
      levelPct: (xp - floor) / (next - floor), nextXp: next,
    };
  }
}
