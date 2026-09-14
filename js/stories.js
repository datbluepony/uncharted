// Road storyteller: finds notable places around you via Wikipedia's free
// geosearch, categorizes them, and "collects" + narrates them as you pass.
import { bus, idb, distance, bearing, angleDiff, clamp, fetchJSON, settings, fmtDist } from './util.js';
import { speech } from './speech.js';

const WIKI = 'https://en.wikipedia.org/w/api.php';

export const CATS = {
  history: { label: 'History', icon: '🏛️' },
  nature: { label: 'Nature', icon: '🌲' },
  town: { label: 'Towns', icon: '🏘️' },
  culture: { label: 'Culture', icon: '🎭' },
  structure: { label: 'Structures', icon: '🌉' },
  oddity: { label: 'Oddities', icon: '👻' },
};
export const RARITY = { common: 10, rare: 25, legendary: 60 };

const SKIP = /\b(rail station|railroad station|railway station|train station|office|headquarters|metro station|bus station|subway station|light rail station|\(MBTA\)|school|academy|club|society|committee|association|organization|foundation|apartment|office building|shopping (mall|center|centre)|supermarket|radio station|television station|tv station|census tract|electoral|constituency|ward|street|avenue|boulevard|interchange|exit \d|parking|hotel|company|corporation|business|restaurant chain|fire station|police station|post office)\b/i;

const RX = {
  oddity: /\b(haunted|ghost town|ghost sign|abandoned|mystery|unexplained|unusual|curious|roadside attraction|folly|disaster|explosion|shipwreck|meteorite|ufo|murder|hoax|oddity|eccentric|quirky)\b/i,
  history: /\b(historic|history|church|cathedral|chapel|synagogue|temple|cemetery|burying ground|battle(field)?|fort|mansion|homestead|monument|memorial|national register|landmark|mill|colonial|revolutionary|civil war|plantation|tavern|meeting ?house|archaeological|built in 1[0-8]\d\d)\b/i,
  nature: /\b(park|lake|river|mountain|mount|hill|forest|woods|beach|creek|brook|falls|waterfall|island|reservoir|trail|preserve|reservation|garden|arboretum|pond|bay|marsh|swamp|wildlife|canyon|valley|peak|summit|cave|spring)\b/i,
  structure: /\b(bridge|tunnel|dam|tower|lighthouse|skyscraper|stadium|arena|ballpark|airport|canal|viaduct|aqueduct|observatory|pier|power station|castle)\b/i,
  culture: /\b(museum|theatre|theater|library|university|college|art|music|venue|cinema|gallery|zoo|aquarium|opera|concert|festival|studio|brewery|winery|market)\b/i,
  town: /\b(city|town|village|borough|township|hamlet|neighborhood|neighbourhood|community|census-designated|municipality|county seat|unincorporated)\b/i,
};

export function categorize(p) {
  const head = `${p.title} ${p.desc || ''}`;
  // Only the first sentence: later sentences mention too many unrelated things.
  const all = `${head} ${((p.extract || '').match(/[^.!?]+[.!?]/) || [''])[0]}`;
  if (RX.oddity.test(all) && !RX.town.test(p.desc || '')) return 'oddity';
  for (const c of ['town', 'structure', 'nature', 'culture', 'history']) if (RX[c].test(p.desc || '')) return c;
  for (const c of ['history', 'structure', 'nature', 'culture', 'town']) if (RX[c].test(head)) return c;
  for (const c of ['history', 'nature', 'structure', 'culture', 'town']) if (RX[c].test(all)) return c;
  return 'history';
}

export function rarityOf(p) {
  const t = `${p.desc || ''} ${p.extract || ''}`;
  if (/\b(National Historic Landmark|UNESCO|World Heritage|National Monument|National Park|oldest (surviving|continuously)|first in the (nation|country|world)|world's (largest|oldest|tallest))\b/i.test(t)) return 'legendary';
  if (/\b(National Register of Historic Places|historic district|state park|listed on|designated|landmark|built in 1[0-8]\d\d)\b/i.test(t) || (p.extract || '').length > 700) return 'rare';
  return 'common';
}

const FREQ = { chill: 70000, normal: 28000, chatty: 9000 };

export class Stories {
  constructor() {
    this.places = new Map(); // all known nearby places
    this.collection = {}; // id -> place (collected)
    this.lastFetch = null;
    this.fetching = false;
    this.lastNarration = 0;
    this.current = null;
  }

  async load() {
    this.collection = await idb.get('collection', {});
    for (const p of Object.values(this.collection)) this.places.set(p.id, p);
  }

  save() {
    idb.set('collection', this.collection);
  }

  list() {
    return [...this.places.values()];
  }

  async maybeFetch(fix) {
    if (this.fetching) return;
    const lf = this.lastFetch;
    const moved = lf ? distance(lf.lat, lf.lon, fix.lat, fix.lon) : Infinity;
    // In dense cities 100 results only cover a few hundred meters, so refetch
    // after covering half of the last search's reach.
    if (lf && moved < Math.max(400, lf.reach * 0.5) && Date.now() - lf.t < 10 * 60000) return;
    this.fetching = true;
    try {
      const { lat, lon } = fix;
      const reach = await this.fetchArea(lat, lon);
      this.lastFetch = { lat, lon, t: Date.now(), reach };
    } catch (e) {
      bus.emit('net-error', { source: 'Wikipedia', message: e.message });
      this.lastFetch = { lat: fix.lat, lon: fix.lon, t: Date.now() - 9 * 60000, reach: 0 }; // retry in ~1 min
    } finally {
      this.fetching = false;
    }
  }

  async fetchArea(lat, lon) {
    const gs = await fetchJSON(
      `${WIKI}?action=query&list=geosearch&gscoord=${lat.toFixed(5)}%7C${lon.toFixed(5)}&gsradius=10000&gslimit=100&format=json&origin=*`
    );
    const all = gs.query?.geosearch || [];
    const reach = all.length ? all.at(-1).dist : 10000;
    const hits = all.filter((h) => !this.places.has(h.pageid) && !SKIP.test(h.title));
    for (let i = 0; i < hits.length; i += 20) {
      const batch = hits.slice(i, i + 20);
      const ids = batch.map((h) => h.pageid).join('|');
      // exintro allows 20 extracts per request (exsentences drops it to 1).
      const d = await fetchJSON(
        `${WIKI}?action=query&prop=extracts|pageimages|description&exintro=1&explaintext=1&exlimit=20&piprop=thumbnail&pithumbsize=480&pilimit=20&pageids=${ids}&format=json&origin=*`
      );
      const pages = d.query?.pages || {};
      for (const h of batch) {
        const pg = pages[h.pageid] || {};
        const p = {
          id: h.pageid,
          title: h.title,
          lat: h.lat,
          lon: h.lon,
          desc: pg.description || '',
          extract: ((pg.extract || '').replace(/\s*\([^)]*listen[^)]*\)/gi, '').split('\n')[0].match(/[^.!?]+[.!?]+(\s|$)/g) || [])
            .slice(0, 5).join('').trim(),
          thumb: pg.thumbnail?.source || '',
        };
        if (SKIP.test(p.desc) || p.extract.length < 60) continue;
        p.cat = categorize(p);
        p.rarity = rarityOf(p);
        this.places.set(p.id, p);
      }
    }
    // Keep memory bounded: drop far-away uncollected places.
    for (const [id, p] of this.places) {
      if (!this.collection[id] && distance(lat, lon, p.lat, p.lon) > 25000) this.places.delete(id);
    }
    bus.emit('places', this.list());
    return reach;
  }

  onFix(fix) {
    this.maybeFetch(fix);
    const s = settings.get();
    // Pace collection so dense downtowns don't flood you with pickups.
    if (Date.now() - (this.lastCollect || 0) < 12000) return;
    const radius = clamp(90 + fix.speed * 9, 90, 450);
    let best = null;
    for (const p of this.places.values()) {
      if (this.collection[p.id] || !s.categories[p.cat]) continue;
      const d = distance(fix.lat, fix.lon, p.lat, p.lon);
      if (d > radius) continue;
      const ahead = fix.heading == null || d < 110 || Math.abs(angleDiff(fix.heading, bearing(fix.lat, fix.lon, p.lat, p.lon))) < 80;
      if (!ahead) continue;
      const rank = RARITY[p.rarity] * 10 - d / 10;
      if (!best || rank > best.rank) best = { p, d, rank };
    }
    if (best) this.collect(best.p, best.d, fix);
  }

  collect(p, d, fix) {
    const now = Date.now();
    this.lastCollect = now;
    p.got = true;
    p.gotAt = now;
    p.gotSpeed = fix?.speed || 0;
    this.collection[p.id] = p;
    this.save();
    const canNarrate = now - this.lastNarration > FREQ[settings.get().storyFreq];
    if (canNarrate) {
      this.lastNarration = now;
      this.current = p;
      speech.say(this.narration(p, d));
    }
    bus.emit('collect', { place: p, distance: d, narrated: canNarrate, points: RARITY[p.rarity] });
    bus.emit('places', this.list());
  }

  narration(p, d) {
    const sentences = p.extract.match(/[^.!?]+[.!?]+(\s|$)/g) || [p.extract];
    const n = settings.get().storyLength === 'long' ? 4 : 2;
    const where = d < 120 ? 'Right here' : `In ${fmtDist(d)}`;
    return `${where}: ${p.title}. ${sentences.slice(0, n).join(' ')}`;
  }

  // Manually trigger narration for a place (from map tap / collection).
  tell(id) {
    const p = this.places.get(Number(id)) || this.collection[id];
    if (!p) return null;
    speech.say(`${p.title}. ${(p.extract.match(/[^.!?]+[.!?]+(\s|$)/g) || [p.extract]).slice(0, 3).join(' ')}`, { priority: true });
    return p;
  }
}
