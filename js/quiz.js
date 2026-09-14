// Parked quiz built from places you actually drove past.
import { ls, escapeHtml, dayKey } from './util.js';
import { CATS } from './stories.js';

const shuffle = (a) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};
const pick = (a, n) => shuffle(a).slice(0, n);

function shortDesc(p) {
  if (p.desc) return p.desc.charAt(0).toUpperCase() + p.desc.slice(1);
  const first = (p.extract.match(/[^.]+\./) || [p.extract])[0];
  return first.replace(new RegExp(p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '___').slice(0, 110);
}

export function buildQuiz(collection, known) {
  const all = Object.values(collection).sort((a, b) => b.gotAt - a.gotAt);
  if (all.length < 4) return [];
  const recent = all.filter((p) => Date.now() - p.gotAt < 7 * 86400000);
  const pool = recent.length >= 4 ? recent : all.slice(0, 40);
  const uncollected = known.filter((p) => !collection[p.id]);
  const qs = [];

  for (const p of shuffle(pool)) {
    const others = all.filter((o) => o.id !== p.id);
    const kinds = shuffle(['what', 'which', 'image', 'where', 'cat']);
    for (const kind of kinds) {
      let q = null;
      if (kind === 'what') {
        const descs = [...new Set(others.map(shortDesc))].filter((d) => d !== shortDesc(p));
        if (descs.length >= 3) q = { prompt: `What is <b>${escapeHtml(p.title)}</b>?`, answer: shortDesc(p), options: [shortDesc(p), ...pick(descs, 3)] };
      } else if (kind === 'which' && uncollected.length >= 3) {
        const when = dayKey(p.gotAt) === dayKey() ? 'today' : 'recently';
        q = { prompt: `Which of these did you drive past ${when}?`, answer: p.title, options: [p.title, ...pick(uncollected, 3).map((o) => o.title)] };
      } else if (kind === 'image' && p.thumb && others.length >= 3) {
        q = { prompt: 'Which place is this?', img: p.thumb, answer: p.title, options: [p.title, ...pick(others, 3).map((o) => o.title)] };
      } else if (kind === 'where' && p.town) {
        const towns = [...new Set(others.map((o) => o.town).filter((t) => t && t !== p.town))];
        if (towns.length >= 2) q = { prompt: `Where were you when you passed <b>${escapeHtml(p.title)}</b>?`, answer: p.town, options: [p.town, ...pick(towns, 3)] };
      } else if (kind === 'cat') {
        q = { prompt: `Which collection does <b>${escapeHtml(p.title)}</b> belong to?`, answer: CATS[p.cat].label, options: [CATS[p.cat].label, ...pick(Object.values(CATS).map((c) => c.label).filter((l) => l !== CATS[p.cat].label), 3)] };
      }
      if (q) {
        q.options = shuffle([...new Set(q.options)]);
        q.fact = (p.extract.match(/[^.!?]+[.!?]+/g) || [p.extract]).slice(0, 2).join(' ');
        qs.push(q);
        break;
      }
    }
    if (qs.length >= 10) break;
  }
  return qs;
}

export function renderQuiz(root, collection, known, onDone) {
  const qs = buildQuiz(collection, known);
  if (!qs.length) {
    root.innerHTML = `<div class="empty-note">🧩 Collect at least 4 places on a drive and a quiz will be waiting for you here.</div>`;
    return;
  }
  let i = 0, score = 0, streak = 0;
  const show = () => {
    if (i >= qs.length) {
      const xp = score * 10;
      ls.set('quizXp', (ls.get('quizXp', 0) || 0) + xp);
      const best = Math.max(ls.get('quizBest', 0), score);
      ls.set('quizBest', best);
      root.innerHTML = `<div class="quiz"><div style="font-size:80px">${score >= qs.length * 0.8 ? '🏆' : score >= qs.length / 2 ? '🎉' : '🧭'}</div>
        <div class="q">${score} / ${qs.length} correct</div><p class="meta">+${xp} XP · best ${best}</p>
        <button class="btn big" id="qAgain">Play again</button></div>`;
      root.querySelector('#qAgain').onclick = () => renderQuiz(root, collection, known, onDone);
      onDone?.();
      return;
    }
    const q = qs[i];
    root.innerHTML = `<div class="quiz">
      <p class="meta">Question ${i + 1} of ${qs.length} · Score ${score}${streak > 1 ? ` · 🔥 ${streak}` : ''}</p>
      ${q.img ? `<div class="qimg" style="background-image:url('${escapeHtml(q.img)}')"></div>` : ''}
      <div class="q">${q.prompt}</div>
      <div class="answers">${q.options.map((o) => `<button data-a="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}</div>
      <p class="meta" id="qFact" style="margin-top:20px;min-height:60px"></p></div>`;
    root.querySelectorAll('.answers button').forEach((b) => {
      b.onclick = () => {
        const right = b.dataset.a === q.answer;
        if (right) { score++; streak++; } else streak = 0;
        root.querySelectorAll('.answers button').forEach((x) => {
          x.disabled = true;
          if (x.dataset.a === q.answer) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        root.querySelector('#qFact').textContent = q.fact;
        setTimeout(() => { i++; show(); }, right ? 2200 : 3800);
      };
    });
  };
  show();
}
