// Place detail pop-up: tap a story card, map pin, or collection item to open
// a full page about the place — large photo, key facts, the article's story
// in readable sections, a photo gallery, nearby places, live distance, and a
// QR code to send the location to your phone. Text from Wikipedia.
import { bus, escapeHtml, distance, bearing, fetchJSON, fmtDist } from './util.js';
import { CATS, RARITY, categorize, rarityOf } from './stories.js';
import { CAT_COLORS } from './map.js';

const API = 'https://en.wikipedia.org/w/api.php';
const REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const STOP = /^(references|notes|see also|external links|further reading|bibliography|sources|citations|footnotes|gallery|works cited|explanatory notes|notes and references)$/i;
const ALLOW = new Set(['P', 'UL', 'OL', 'LI', 'B', 'I', 'EM', 'STRONG', 'SUB', 'SUP', 'BLOCKQUOTE', 'BR', 'ABBR', 'SMALL', 'Q', 'CITE']);
const cache = new Map();
const $ = (id) => document.getElementById(id);

export class Detail {
  constructor(deps) {
    this.d = deps;
    this.el = $('modal');
    this.body = $('modalBody');
    this.stack = [];
    this.current = null;
    this.seq = 0;
    this.el.querySelector('.modal-x').onclick = () => this.close();
    this.el.querySelector('.modal-backdrop').onclick = () => this.close();
    this.backBtn = this.el.querySelector('.modal-back');
    this.backBtn.onclick = () => this.back();
    addEventListener('keydown', (e) => e.key === 'Escape' && this.open && this.close());
    bus.on('fix', () => this.open && this.updateDistance());
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  close() {
    this.el.classList.add('closing');
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      this.el.classList.add('hidden');
      this.el.classList.remove('closing');
      this.body.innerHTML = '';
    }, 220);
    this.stack = [];
    this.current = null;
    this.d.onClose?.();
  }

  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev, false);
  }

  resolve(ref) {
    const { stories } = this.d;
    if (ref.id != null) {
      const p = stories.places.get(Number(ref.id)) || stories.collection[ref.id];
      if (p) return p;
    }
    if (ref.title) {
      const t = ref.title.toLowerCase();
      for (const p of stories.places.values()) if (p.title.toLowerCase() === t) return p;
      return { title: ref.title, desc: '', extract: '', thumb: '' };
    }
    return null;
  }

  // ref: { id } or { title }
  openPlace(ref) {
    const p = this.resolve(ref);
    if (!p) return;
    if (this.open && this.current) this.stack.push(this.current);
    else this.stack = [];
    this.show(p, true);
  }

  show(p, animate) {
    // Cancel a close that is still animating so it can't hide this place.
    clearTimeout(this.closeTimer);
    this.el.classList.remove('closing');
    this.current = p;
    this.el.classList.remove('hidden');
    if (animate) {
      this.el.classList.remove('opening');
      void this.el.offsetWidth;
      this.el.classList.add('opening');
    }
    this.backBtn.classList.toggle('hidden', !this.stack.length);
    this.render(p);
    this.load(p);
  }

  render(p) {
    const got = this.d.stories.collection[p.id];
    const cat = p.cat || (p.extract ? categorize(p) : null);
    const rarity = p.rarity || (p.extract ? rarityOf(p) : null);
    const hasLoc = p.lat != null;
    const locked = this.d.isLocked();
    const badges = [
      cat ? `<span class="badge" style="background:${CAT_COLORS[cat]}">${CATS[cat].icon} ${CATS[cat].label}</span>` : '',
      rarity && rarity !== 'common' ? `<span class="badge rar-${rarity}-b">${rarity === 'legendary' ? '👑' : '✨'} ${rarity} · +${RARITY[rarity]} XP</span>` : '',
      got ? `<span class="badge got-b">✓ Collected ${new Date(got.gotAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}${got.town ? ' · ' + escapeHtml(got.town) : ''}</span>` : '',
    ].join('');
    const lead = (p.extract || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [];

    this.body.innerHTML = `
      <header class="dt-hero ${p.thumb ? '' : 'noimg'}" id="dtHero" style="${p.thumb ? `background-image:url('${escapeHtml(p.thumb)}')` : ''}">
        <div class="dt-hero-shade"></div>
        <div class="dt-hero-text">
          <div class="dt-badges">${badges}</div>
          <h1>${escapeHtml(p.title)}</h1>
          <p class="dt-desc" id="dtDesc">${escapeHtml(p.desc || '')}</p>
        </div>
      </header>
      <div class="dt-actions">
        <button class="btn" data-act="listen">🔊 Listen</button>
        ${hasLoc ? '<button class="btn ghost" data-act="map">📍 Show on map</button><button class="btn ghost" data-act="phone">📱 Send to phone</button>' : ''}
        ${hasLoc ? '<div class="dt-dist" id="dtDist"><i class="dt-arrow" id="dtArrow">➤</i><span id="dtDistTxt">—</span></div>' : ''}
      </div>
      <div id="dtQR" class="dt-qr hidden"></div>
      <section class="dt-lead" id="dtLead">${lead.length ? `<p>${escapeHtml(lead.slice(0, locked ? 2 : 5).join(' '))}</p>` : '<p class="muted">Loading…</p>'}</section>
      ${locked ? `
        <div class="lock dt-lock"><div class="lock-icon">🔒</div><h2>The full story unlocks when parked</h2>
        <p>Photos, key facts and the complete history are one tap away for passengers.</p>
        <button class="btn" id="dtPassenger">I'm a passenger</button></div>` : `
        <div id="dtFacts"></div>
        <div id="dtGallery"></div>
        <div id="dtStory"><div class="dt-loading"><span></span><span></span><span></span> Loading the full story</div></div>
        <div id="dtNearby"></div>
        <footer class="dt-foot">Text and images from Wikipedia (CC BY-SA 4.0) ·
          <a href="https://en.m.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}" target="_blank" rel="noopener">Open the full article ↗</a></footer>`}`;

    this.body.scrollTop = 0;
    this.body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this.action(b.dataset.act)));
    const pass = $('dtPassenger');
    if (pass) pass.onclick = () => { this.d.unlockPassenger(); this.show(p, false); };
    if (!locked) this.renderNearby(p);
    this.updateDistance();
  }

  action(act) {
    const p = this.current;
    if (act === 'listen') {
      const text = this.fullLead || p.extract;
      this.d.speech.say(`${p.title}. ${(text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text]).slice(0, 6).join(' ')}`, { priority: true, kind: 'manual' });
    } else if (act === 'map') {
      this.close();
      this.d.showOnMap(p);
    } else if (act === 'phone') {
      this.showQR(p);
    }
  }

  async showQR(p) {
    const box = $('dtQR');
    if (!box.classList.contains('hidden')) return box.classList.add('hidden');
    box.classList.remove('hidden');
    const url = `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    box.innerHTML = `<div id="dtQRCode" class="qr-code"></div><div><b>Scan with your phone</b>
      <p>Opens ${escapeHtml(p.title)} in Maps. Share it to the Tesla app to send it to the car's navigation.</p></div>`;
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      new window.QRCode($('dtQRCode'), { text: url, width: 176, height: 176, colorDark: '#000000', colorLight: '#ffffff' });
    } catch {
      $('dtQRCode').textContent = url;
    }
  }

  updateDistance() {
    const p = this.current;
    const fix = this.d.getFix();
    const txt = $('dtDistTxt');
    if (!p || p.lat == null || !txt) return;
    if (!fix) return (txt.textContent = 'Waiting for location');
    const d = distance(fix.lat, fix.lon, p.lat, p.lon);
    const b = bearing(fix.lat, fix.lon, p.lat, p.lon);
    txt.textContent = d < 60 ? "You're here" : `${fmtDist(d)} away`;
    $('dtArrow').style.transform = `rotate(${b - (fix.heading ?? 0) - 90}deg)`;
  }

  renderNearby(p) {
    const box = $('dtNearby');
    if (!box || p.lat == null) return;
    const near = [...this.d.stories.places.values()]
      .filter((o) => o.id !== p.id && o.lat != null)
      .map((o) => ({ o, d: distance(p.lat, p.lon, o.lat, o.lon) }))
      .filter((x) => x.d < 1500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 10);
    if (!near.length) return;
    box.innerHTML = `<h2 class="sec">Nearby</h2><div class="dt-chips">${near
      .map(({ o, d }) => `<button class="dt-chip" data-id="${o.id}" style="--c:${CAT_COLORS[o.cat] || '#fff'}"><i></i>${escapeHtml(o.title)}<small>${fmtDist(d)}</small></button>`)
      .join('')}</div>`;
    box.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => this.openPlace({ id: b.dataset.id })));
  }

  async load(p) {
    if (this.d.isLocked()) return;
    const token = ++this.seq;
    let data = cache.get(p.title);
    if (!data) {
      try {
        const t = encodeURIComponent(p.title.replace(/ /g, '_'));
        const [summary, parsed] = await Promise.all([
          fetchJSON(REST + t).catch(() => null),
          fetchJSON(`${API}?action=parse&page=${t}&prop=text&formatversion=2&format=json&origin=*&redirects=1&disableeditsection=1&disabletoc=1&mobileformat=1`, { timeout: 20000 }),
        ]);
        data = { summary, article: parseArticle(parsed.parse?.text || '') };
        cache.set(p.title, data);
      } catch (e) {
        if (token !== this.seq) return;
        const story = $('dtStory');
        if (story) story.innerHTML = `<p class="muted">Couldn't load more details (${escapeHtml(e.message)}). Check the connection and try again.</p>`;
        return;
      }
    }
    if (token !== this.seq || !this.open) return;
    const { summary, article } = data;

    // Hero: swap in the full-resolution photo once it has loaded.
    const hi = summary?.originalimage?.source || summary?.thumbnail?.source;
    if (hi) {
      const img = new Image();
      img.onload = () => {
        const hero = $('dtHero');
        if (hero && token === this.seq) {
          hero.style.backgroundImage = `url('${hi}')`;
          hero.classList.remove('noimg');
        }
      };
      img.src = hi;
    }
    if (!p.desc && summary?.description) $('dtDesc').textContent = summary.description;
    if (p.lat == null && summary?.coordinates) {
      p.lat = summary.coordinates.lat;
      p.lon = summary.coordinates.lon;
    }

    // Lead
    if (article.lead.length) {
      $('dtLead').innerHTML = article.lead.join('');
      this.fullLead = $('dtLead').textContent;
    } else if (summary?.extract) {
      $('dtLead').innerHTML = `<p>${escapeHtml(summary.extract)}</p>`;
      this.fullLead = summary.extract;
    }

    // Key facts
    if (article.facts.length) {
      $('dtFacts').innerHTML = `<h2 class="sec">Key facts</h2><div class="dt-facts">${article.facts
        .map(([k, v]) => `<div class="dt-fact"><small>${escapeHtml(k)}</small><b>${escapeHtml(v)}</b></div>`)
        .join('')}</div>`;
    }

    // Gallery
    if (article.images.length) {
      $('dtGallery').innerHTML = `<h2 class="sec">Photos</h2><div class="dt-gallery">${article.images
        .map((im, i) => `<figure data-i="${i}"><img loading="lazy" src="${escapeHtml(im.src)}" data-fallback="${escapeHtml(im.thumb)}" alt=""><figcaption>${escapeHtml(im.cap)}</figcaption></figure>`)
        .join('')}</div>`;
      $('dtGallery').querySelectorAll('img').forEach((img) => (img.onerror = () => {
        // Try the original thumbnail size, then drop the photo entirely.
        if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
        else img.closest('figure')?.remove();
      }));
      $('dtGallery').querySelectorAll('figure').forEach((f) => (f.onclick = () => this.lightbox(article.images[+f.dataset.i])));
    }

    // Story sections
    const story = $('dtStory');
    story.innerHTML = article.sections.length
      ? `<h2 class="sec">The full story</h2>${article.sections
          .map((s, i) => `<details class="dt-sec" ${i === 0 ? 'open' : ''}><summary>${escapeHtml(s.title)}</summary><div class="dt-sec-body">${s.html.join('')}</div></details>`)
          .join('')}`
      : '';
    this.body.querySelectorAll('a[data-wiki]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); this.openPlace({ title: a.dataset.wiki }); }));
  }

  lightbox(im) {
    const lb = document.createElement('div');
    lb.className = 'dt-lightbox';
    lb.innerHTML = `<img src="${escapeHtml(im.src)}" alt=""><p>${escapeHtml(im.cap)}</p><span>Tap to close</span>`;
    lb.querySelector('img').onerror = function () { this.src = im.thumb; };
    lb.onclick = () => lb.remove();
    this.el.querySelector('.modal-card').appendChild(lb);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.QRCode) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Turn MediaWiki HTML into facts, images, lead and sections of safe markup.
export function parseArticle(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') || doc.body;

  const facts = [];
  const info = root.querySelector('table.infobox');
  if (info) {
    for (const tr of info.querySelectorAll('tr')) {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (!th || !td) continue;
      td.querySelectorAll('sup, style, .noprint, .geo-inline-hidden, br').forEach((n) => n.replaceWith(' '));
      const k = th.textContent.replace(/\s+/g, ' ').trim();
      const v = td.textContent.replace(/\s+/g, ' ').trim();
      if (!k || !v || /coordinates|location map|website/i.test(k)) continue;
      facts.push([k.slice(0, 40), v.length > 110 ? v.slice(0, 107) + '…' : v]);
      if (facts.length >= 10) break;
    }
  }

  const images = [];
  const seen = new Set();
  for (const img of root.querySelectorAll('img')) {
    const w = +img.getAttribute('width') || 0;
    let src = img.getAttribute('src') || '';
    if (img.closest('.locmap, .mw-kartographer-map, .geo-map, .infobox-image .notpageimage')) continue;
    if (w < 120 || !src || /Flag_of|location_map|Locator|relief_map|Commons-logo|Wiktionary|Wikisource|Question_book|Symbol_|Edit-clear|Ambox|Padlock|Increase|Decrease/i.test(src)) continue;
    if (src.startsWith('//')) src = 'https:' + src;
    const large = src.replace(/\/(\d+)px-/, '/800px-');
    if (seen.has(large)) continue;
    seen.add(large);
    const cap = (img.closest('figure, .thumb')?.querySelector('figcaption, .thumbcaption')?.textContent || img.getAttribute('alt') || '').trim();
    images.push({ src: large, thumb: src, cap: cap.slice(0, 160) });
    if (images.length >= 10) break;
  }

  root.querySelectorAll('table, figure, .thumb, .gallery, .navbox, .reflist, .references, .mw-references-wrap, sup.reference, .mw-editsection, .hatnote, .metadata, style, script, .shortdescription, .noprint, .mw-empty-elt, .sistersitebox, .side-box, link, meta').forEach((n) => n.remove());

  const lead = [];
  const sections = [];
  let cur = null;
  for (const el of root.querySelectorAll('h2, h3, p, ul, ol, blockquote')) {
    if (el.parentElement?.closest('ul, ol, blockquote, li')) continue;
    if (el.tagName === 'H2') {
      const t = el.textContent.trim();
      cur = STOP.test(t) ? 'stop' : { title: t, html: [] };
      if (cur !== 'stop') sections.push(cur);
      continue;
    }
    if (cur === 'stop') continue;
    if (el.tagName === 'H3') {
      if (cur) cur.html.push(`<h4>${escapeHtml(el.textContent.trim())}</h4>`);
      continue;
    }
    const inner = clean(el);
    if (!inner.replace(/<[^>]+>/g, '').trim()) continue;
    const tag = el.tagName.toLowerCase();
    (cur ? cur.html : lead).push(`<${tag}>${inner}</${tag}>`);
  }
  return { facts, images, lead, sections: sections.filter((s) => s.html.length) };
}

function clean(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) out += escapeHtml(n.textContent);
    else if (n.nodeType === 1) {
      const tag = n.tagName;
      if (tag === 'A') {
        const m = (n.getAttribute('href') || '').match(/^\/wiki\/([^:#?]+)$/);
        const inner = clean(n);
        out += m ? `<a data-wiki="${escapeHtml(decodeURIComponent(m[1]).replace(/_/g, ' '))}">${inner}</a>` : inner;
      } else if (tag === 'BR') out += '<br>';
      else if (ALLOW.has(tag)) {
        const t = tag.toLowerCase();
        out += `<${t}>${clean(n)}</${t}>`;
      } else out += clean(n);
    }
  }
  return out;
}
