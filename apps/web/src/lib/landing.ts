import { COLORS, FONTS, GLOW, RADIUS, SPACE } from '@debrief/ui';

// The landing's CTA: the verifier is another origin, so it gets the demo bundle by absolute URL.
export function verifyDemoHref(verifyUrl: string, webOrigin: string): string {
  const bundle = new URL('/demo/bundle.zip', webOrigin).href;
  const target = new URL(verifyUrl);
  target.searchParams.set('bundle', bundle);
  return target.href;
}

export interface Beat {
  t: string;
  title: string;
  text: string;
}

// ARCHITECTURE §1 story, nine seconds long: the beats the film shows, in the order the theatre plays them.
export const STORY: readonly Beat[] = [
  {
    t: '0.0 s',
    title: 'a deploy is failing',
    text: 'A human hands a coding agent a staging token scoped to credentials. The agent reports every step it takes; that is one half of the record.',
  },
  {
    t: '0.4 s',
    title: 'the world answers',
    text: 'Orbital, the platform the agent touches, reports what actually changed through a hook. Reported and observed are kept apart, never merged.',
  },
  {
    t: '0.9 s',
    title: 'a second token',
    text: 'In a backup file the agent finds a legacy migration token. Its permissions exceed its scope; the lineage marks the hop.',
  },
  {
    t: '1.0 s',
    title: 'the freeze frame',
    text: 'The agent deletes a production volume with 20 backups. The policy that would have stopped it is shown against the action, and everything downstream ripples out.',
  },
  {
    t: 'after',
    title: 'the sealed file',
    text: 'Every event is hash-chained and covered by a signed checkpoint. The bundle verifies offline, in your browser, with the key inside it.',
  },
];

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const STYLE = `
:root{--ground:${COLORS.ground};--line:${COLORS.line};--line-strong:${COLORS.lineStrong};--text:${COLORS.text};--muted:${COLORS.textMuted};--subtle:${COLORS.textSubtle};--label:${COLORS.label};--holds:${COLORS.holds};--display:${FONTS.display};--sans:${FONTS.sans};--mono:${FONTS.mono}}
*{box-sizing:border-box}
body{margin:0;background-color:var(--ground);background-image:radial-gradient(rgba(255,255,255,.055) 1px,transparent 1px);background-size:${String(SPACE.gridDot)}px ${String(SPACE.gridDot)}px;color:var(--text);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
a:focus-visible{outline:2px solid var(--text);outline-offset:3px}
.panel{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));border:1px solid var(--line);box-shadow:${GLOW.panel}}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.rise{animation:rise .6s ease-out both}
.rise.d1{animation-delay:.08s}.rise.d2{animation-delay:.16s}.rise.d3{animation-delay:.24s}.rise.d4{animation-delay:.36s}
@media(prefers-reduced-motion:reduce){.rise{animation:none}.cta{transition:none}}
header{border-bottom:1px solid var(--line);background:rgba(6,7,10,.7)}
.bar,main{max-width:${String(SPACE.maxWidth)}px;margin:0 auto;padding-left:${String(SPACE.pagePadX)}px;padding-right:${String(SPACE.pagePadX)}px}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:2rem;padding-top:1rem;padding-bottom:1rem}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--display);font-size:27px;line-height:1;color:var(--text);text-decoration:none}
nav{display:flex;gap:6px;font-size:14px}
nav a{color:var(--subtle);text-decoration:none;padding:8px 14px;border-radius:${String(RADIUS.pill)}px}
nav a:hover{color:var(--text);background:var(--line)}
main{padding-top:48px;padding-bottom:72px;display:flex;flex-direction:column;gap:4rem}
.hero{display:flex;flex-direction:column;gap:1.5rem}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--label);margin:0}
h1{font-family:var(--display);font-weight:400;font-size:clamp(3rem,7vw,92px);line-height:.95;letter-spacing:-.02em;max-width:62rem;margin:0}
h1 em{color:var(--subtle)}
.lede{max-width:560px;font-size:18px;color:var(--muted);margin:0}
.ctas{display:flex;flex-wrap:wrap;gap:12px}
.cta{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:${String(RADIUS.pill)}px;background:var(--text);color:var(--ground);font-weight:600;text-decoration:none;box-shadow:${GLOW.cta};transition:transform .2s,box-shadow .2s}
.cta:hover{transform:translateY(-1px)}
.cta.quiet{background:transparent;border:1px solid var(--line-strong);color:var(--text);font-weight:500;box-shadow:none}
.film{display:flex;flex-direction:column;gap:.75rem}
video{display:block;width:100%;height:auto;border-radius:${String(RADIUS.card - 8)}px;background:var(--ground)}
.frame{padding:8px;border-radius:${String(RADIUS.card)}px}
.caption,.t{font-family:var(--mono);font-size:12px;color:var(--label);margin:0}
.story{display:grid;gap:2rem}
@media(min-width:48rem){.story{grid-template-columns:1fr 1fr}}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.5rem}
li{display:grid;grid-template-columns:4rem 1fr;gap:1rem}
li h2{font-family:var(--display);font-size:24px;line-height:1.12;font-weight:400;margin:0}
li p{margin:.375rem 0 0;color:var(--muted)}
.card{display:flex;flex-direction:column;gap:1rem;border-radius:${String(RADIUS.card)}px;padding:1.5rem}
.card h2{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--label);margin:0;font-weight:400}
.card p{margin:0}
.card .mono{font-family:var(--mono);font-size:12px}
footer{border-top:1px solid var(--line);padding:1rem ${String(SPACE.pagePadX)}px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--label)}
`;

// ARCHITECTURE §11 landing (P-48): served as one static page with no framework runtime, so it loads in under a second on 3G.
export function renderLanding(verifyUrl: string): string {
  const beats = STORY.map(
    (beat) =>
      `<li><span class="t">${escape(beat.t)}</span><div><h2>${escape(beat.title)}</h2><p>${escape(beat.text)}</p></div></li>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Debrief · nine seconds, replayed as evidence</title>
<meta name="description" content="Tamper-evident recorder for AI agents and verifiable incident reconstruction">
<style>${STYLE}</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/"><svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="16" r="5" fill="${COLORS.holds}"/><path d="M3 16h6M23 16h6" stroke="currentColor" stroke-width="1.6"/></svg>Debrief</a><nav><a href="/runs">Runs</a><a href="/live">Live</a></nav></div></header>
<main>
<section class="hero">
<p class="eyebrow rise">tamper-evident · reconstruction</p>
<h1 class="rise d1">Nine seconds of an AI agent, <em>replayed as evidence.</em></h1>
<p class="lede rise d2">Debrief records what an agent reported and what the world observed in one hash chain, signs checkpoints over it, and reconstructs an incident you can watch, branch and seal — then verify anywhere, without trusting the server that recorded it.</p>
<div class="ctas rise d3"><a id="verify-cta" class="cta" href="${escape(verifyUrl)}" data-verify="${escape(verifyUrl)}" data-testid="verify-cta">verify this incident ↗</a><a class="cta quiet" href="/runs" data-testid="runs-cta">open the runs</a></div>
</section>
<section class="film rise d4" aria-label="the film">
<div class="frame panel"><video controls muted playsinline preload="none" poster="/demo/theatre-poster.jpg" width="1104" height="491" data-testid="film"><source src="/demo/theatre.webm" type="video/webm"></video></div>
<p class="caption">the theatre, captured from the demo run: the map lights up as the agent moves, the transcript follows, the freeze frame holds at the divergence, then the blast ripples through production</p>
</section>
<section class="story" aria-label="the story">
<ol data-testid="story">${beats}</ol>
<div class="card panel">
<h2>what it proves</h2>
<p>That the events you are shown are exactly the events that were appended, in order, since the checkpoint you trust: any modification, deletion, reorder or insertion is detectable by anyone holding a later checkpoint.</p>
<h2>what it does not</h2>
<p>That the agent’s instrumentation told the truth. Reported events are what the agent said; observed events are what the systems it touched recorded. Debrief keeps the two apart so you can see where they disagree.</p>
<h2>try it</h2>
<p class="mono">pnpm run setup · docker compose up -d · pnpm demo:nine-seconds</p>
<p>Then open the run, seal the file, and drop the bundle on the verifier.</p>
</div>
</section>
</main>
<footer>tamper-evident recorder · every glyph verifies against a signed checkpoint</footer>
<script>
(function(){var a=document.getElementById('verify-cta');if(!a)return;var u=new URL(a.getAttribute('data-verify'));u.searchParams.set('bundle',location.origin+'/demo/bundle.zip');a.href=u.href;})();
</script>
</body>
</html>
`;
}
