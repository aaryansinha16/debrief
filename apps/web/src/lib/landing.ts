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
body{margin:0;background:var(--stage);background-image:radial-gradient(60% 50% at 50% -10%,color-mix(in srgb,var(--cyan) 9%,transparent),transparent 70%),radial-gradient(40% 40% at 90% 100%,color-mix(in srgb,var(--ember) 8%,transparent),transparent 70%);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased}
.field{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.85}
body>*:not(.field){position:relative;z-index:1}
.glass{background:color-mix(in srgb,var(--raised) 72%,transparent);border:1px solid color-mix(in srgb,white 9%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,white 5%,transparent),0 24px 60px -36px black;backdrop-filter:blur(18px) saturate(1.2)}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.rise{animation:rise .6s cubic-bezier(.2,.8,.2,1) both}
.rise.d1{animation-delay:.08s}.rise.d2{animation-delay:.16s}.rise.d3{animation-delay:.24s}.rise.d4{animation-delay:.36s}
@media(prefers-reduced-motion:reduce){.rise{animation:none}.field{display:none}}
header{border-bottom:1px solid color-mix(in srgb,white 9%,transparent)}
.bar{max-width:72rem;margin:0 auto;display:flex;align-items:center;gap:2rem;padding:.75rem 1.5rem}
.brand{display:flex;align-items:center;gap:.5rem;font-family:var(--mono);font-size:.875rem;letter-spacing:.25em;text-transform:uppercase;color:var(--text);text-decoration:none}
.brand::before{content:'';display:inline-block;width:.625rem;height:.625rem;border-radius:2px;background:var(--ember);box-shadow:0 0 12px var(--ember)}
nav{display:flex;gap:.25rem;font-size:.875rem}
nav a{color:var(--muted);text-decoration:none;padding:.25rem .625rem;border-radius:6px}
nav a:hover{color:var(--text)}
main{max-width:72rem;margin:0 auto;padding:2rem 1.5rem 4rem;display:flex;flex-direction:column;gap:4rem}
.hero{display:flex;flex-direction:column;gap:1.25rem;padding-top:1.5rem}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--ember);margin:0}
h1{font-size:clamp(2rem,4vw,3rem);line-height:1.15;font-weight:600;max-width:48rem;margin:0}
.lede{max-width:40rem;font-size:1.125rem;color:var(--muted);margin:0}
.ctas{display:flex;flex-wrap:wrap;gap:.75rem}
.cta{display:inline-flex;align-items:center;height:2.25rem;border:1px solid ${COLORS.cyanDim};border-radius:6px;padding:0 1rem;background:color-mix(in srgb,var(--cyan) 10%,transparent);font-family:var(--mono);font-size:.8125rem;color:var(--cyan);text-decoration:none}
.cta{transition:transform .2s,box-shadow .2s,background-color .2s,border-color .2s}
.cta:hover{background:color-mix(in srgb,var(--cyan) 20%,transparent);border-color:var(--cyan);transform:translateY(-1px);box-shadow:0 0 0 1px color-mix(in srgb,var(--cyan) 35%,transparent),0 0 24px -6px var(--cyan)}
.cta.quiet{border-color:var(--edge);background:var(--raised);color:var(--text)}
.cta.quiet:hover{border-color:var(--muted);background:var(--raised)}
.film{display:flex;flex-direction:column;gap:.75rem}
video{display:block;width:100%;height:auto;border-radius:8px;background:var(--stage)}
.frame{padding:.5rem;border-radius:12px}
.caption,.t{font-family:var(--mono);font-size:.75rem;color:var(--muted);margin:0}
.story{display:grid;gap:2rem}
@media(min-width:48rem){.story{grid-template-columns:1fr 1fr}}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.5rem}
li{display:grid;grid-template-columns:4rem 1fr;gap:1rem}
li h2{font-size:1rem;font-weight:600;margin:0}
li p{margin:.25rem 0 0;font-size:.875rem;color:var(--muted)}
.card{display:flex;flex-direction:column;gap:1rem;border-radius:12px;padding:1.25rem;font-size:.875rem}
.card h2{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:0;font-weight:500}
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
<canvas class="field" aria-hidden="true"></canvas>
<header><div class="bar"><a class="brand" href="/">debrief</a><nav><a href="/runs">Runs</a><a href="/live">Live</a></nav></div></header>
<main>
<section class="hero">
<p class="eyebrow rise">tamper-evident · reconstruction</p>
<h1 class="rise d1">Nine seconds of an AI agent, replayed as evidence.</h1>
<p class="lede rise d2">Debrief records what an agent reported and what the world observed in one hash chain, signs checkpoints over it, and reconstructs an incident you can watch, branch and seal — then verify anywhere, without trusting the server that recorded it.</p>
<div class="ctas rise d3"><a id="verify-cta" class="cta" href="${escape(verifyUrl)}" data-verify="${escape(verifyUrl)}" data-testid="verify-cta">verify this incident ↗</a><a class="cta quiet" href="/runs" data-testid="runs-cta">open the runs</a></div>
</section>
<section class="film rise d4" aria-label="the film">
<div class="frame glass"><video controls muted playsinline preload="none" poster="/demo/theatre-poster.jpg" width="1104" height="491" data-testid="film"><source src="/demo/theatre.webm" type="video/webm"></video></div>
<p class="caption">the theatre, captured from the demo run: the map lights up as the agent moves, the transcript follows, the freeze frame holds at the divergence, then the blast ripples through production</p>
</section>
<section class="story" aria-label="the story">
<ol data-testid="story">${beats}</ol>
<div class="card glass">
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
// The field starts after load so it never counts against the page's arrival, and stays still under reduced motion.
addEventListener('load',function(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;var c=document.querySelector('.field'),x=c.getContext('2d');if(!x)return;var W,H,P=[],s=7,r=function(){s=(s*1664525+1013904223)>>>0;return s/4294967296};function size(){W=c.width=innerWidth*devicePixelRatio;H=c.height=innerHeight*devicePixelRatio}size();addEventListener('resize',size);for(var i=0;i<420;i++)P.push({x:r(),y:r(),z:.3+r()*.7,e:r()<.22,v:.02+r()*.05,o:r()*6.28});function f(t){x.clearRect(0,0,W,H);for(var i=0;i<P.length;i++){var p=P[i];p.y-=p.v*.0006*p.z;if(p.y<-.02)p.y=1.02;var px=(p.x+Math.sin(t*.0002+p.o)*.01)*W,py=p.y*H,R=(.8+p.z*1.8)*devicePixelRatio;x.globalAlpha=.25+p.z*.45;x.fillStyle=p.e?'${COLORS.ember}':'${COLORS.cyan}';x.beginPath();x.arc(px,py,R,0,6.28);x.fill()}if(!document.hidden)requestAnimationFrame(f);else setTimeout(function(){requestAnimationFrame(f)},500)}requestAnimationFrame(f)});
</script>
</body>
</html>
`;
}
