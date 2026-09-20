import { COLORS, FONTS } from '@debrief/ui';

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
:root{--stage:${COLORS.stage};--raised:${COLORS.stageRaised};--edge:${COLORS.stageEdge};--text:${COLORS.text};--muted:${COLORS.textMuted};--ember:${COLORS.ember};--cyan:${COLORS.cyan};--sans:${FONTS.sans};--mono:${FONTS.mono}}
*{box-sizing:border-box}
body{margin:0;background:var(--stage);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
header{border-bottom:1px solid var(--edge)}
.bar{max-width:72rem;margin:0 auto;display:flex;align-items:center;gap:2rem;padding:1rem 1.5rem}
.brand{font-family:var(--mono);font-size:.875rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text);text-decoration:none}
nav{display:flex;gap:1.5rem;font-size:.875rem}
nav a{color:var(--muted);text-decoration:none}
nav a:hover{color:var(--text)}
main{max-width:72rem;margin:0 auto;padding:2rem 1.5rem 4rem;display:flex;flex-direction:column;gap:4rem}
.hero{display:flex;flex-direction:column;gap:1.25rem;padding-top:1.5rem}
.eyebrow{font-family:var(--mono);font-size:.75rem;letter-spacing:.3em;text-transform:uppercase;color:var(--ember);margin:0}
h1{font-size:clamp(2rem,4vw,3rem);line-height:1.15;font-weight:600;max-width:48rem;margin:0}
.lede{max-width:40rem;font-size:1.125rem;color:var(--muted);margin:0}
.ctas{display:flex;flex-wrap:wrap;gap:.75rem}
.cta{border:1px solid var(--cyan);border-radius:4px;padding:.625rem 1.25rem;font-family:var(--mono);font-size:.875rem;color:var(--cyan);text-decoration:none}
.cta.quiet{border-color:var(--edge);color:var(--muted)}
.cta:hover{background:var(--raised)}
.film{display:flex;flex-direction:column;gap:.75rem}
video{width:100%;height:auto;border:1px solid var(--edge);border-radius:4px;background:var(--stage)}
.caption,.t{font-family:var(--mono);font-size:.75rem;color:var(--muted);margin:0}
.story{display:grid;gap:2rem}
@media(min-width:48rem){.story{grid-template-columns:1fr 1fr}}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.5rem}
li{display:grid;grid-template-columns:4rem 1fr;gap:1rem}
li h2{font-size:1rem;font-weight:600;margin:0}
li p{margin:.25rem 0 0;font-size:.875rem;color:var(--muted)}
.card{display:flex;flex-direction:column;gap:1rem;border:1px solid var(--edge);border-radius:4px;background:var(--raised);padding:1.25rem;font-size:.875rem}
.card h2{font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0;font-weight:400}
.card p{margin:0}
.card .mono{font-family:var(--mono);font-size:.75rem}
footer{border-top:1px solid var(--edge);padding:1rem 1.5rem;text-align:center;font-size:.75rem;color:var(--muted)}
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
<header><div class="bar"><a class="brand" href="/">debrief</a><nav><a href="/runs">Runs</a><a href="/live">Live</a></nav></div></header>
<main>
<section class="hero">
<p class="eyebrow">tamper-evident · reconstruction</p>
<h1>Nine seconds of an AI agent, replayed as evidence.</h1>
<p class="lede">Debrief records what an agent reported and what the world observed in one hash chain, signs checkpoints over it, and reconstructs an incident you can watch, branch and seal — then verify anywhere, without trusting the server that recorded it.</p>
<div class="ctas"><a id="verify-cta" class="cta" href="${escape(verifyUrl)}" data-verify="${escape(verifyUrl)}" data-testid="verify-cta">verify this incident ↗</a><a class="cta quiet" href="/runs" data-testid="runs-cta">open the runs</a></div>
</section>
<section class="film" aria-label="the film">
<video controls muted playsinline preload="none" poster="/demo/theatre-poster.png" width="766" height="478" data-testid="film"><source src="/demo/theatre.webm" type="video/webm"></video>
<p class="caption">the theatre, captured from the demo run: establishing shot, follow the agent, freeze at the divergence, ripple, pull back to the lineage</p>
</section>
<section class="story" aria-label="the story">
<ol data-testid="story">${beats}</ol>
<div class="card">
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
