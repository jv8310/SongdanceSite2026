// ── Workshop · Parallax — the cinematic scroll engine ──────────────────────
//
// This drives the "Apple-product-page" storytelling on /workshop-parallax:
// pinned chapters that scrub with the scroll, a cross-fading cinema where the
// background changes underneath crawling lines of text, layered parallax, and
// line-by-line word crawls. Everything is GSAP + ScrollTrigger (already a
// project dependency, same import pattern as the homepage's animations.ts).
//
// Reduced-motion is respected hard: when the user prefers reduced motion we
// register nothing scroll-scrubbed, pin nothing, and simply make every element
// visible in its rest state. The page stays fully readable without JS too —
// the CSS rest-state is "visible", and we only *add* the pre-animation hidden
// state once we know JS + motion are on (via the .wp-anim class on <html>).

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ease = 'power2.out';

// Guard: if anything throws we never want the page left in a hidden state.
function revealAll() {
  document.querySelectorAll<HTMLElement>('.wp-rise, .wp-fade, .wp-line').forEach((el) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.classList.add('is-in');
  });
}

if (reduce) {
  revealAll();
} else {
  // Tell the CSS it may apply the pre-animation hidden states now that motion
  // is confirmed on. (Without this class the page renders fully visible.)
  root.classList.add('wp-anim');

  try {
    initHero();
    initThread();
    initCinema();
    initMethod();
    initParallax();
    initRises();
    initLineCrawls();
    initProgress();
  } catch (err) {
    // Never strand the reader behind a broken animation.
    // eslint-disable-next-line no-console
    console.error('[workshop-parallax] animation init failed:', err);
    revealAll();
  }

  // Images load late; recalc the pin/scrub geometry once they're in.
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

// ── Hero ───────────────────────────────────────────────────────────────────
// A held breath: the title and subtitle drift up and resolve, the backdrop
// scales down a touch (a slow inhale), and on scroll the whole hero fades and
// recedes so the next chapter feels like emerging from it.
function initHero() {
  const hero = document.querySelector<HTMLElement>('.wp-hero');
  if (!hero) return;

  const tl = gsap.timeline({ defaults: { ease, duration: 1.1 } });
  tl.from('.wp-hero-bg', { scale: 1.14, opacity: 0, duration: 2.0 })
    .from('.wp-hero-eyebrow', { opacity: 0, y: 16 }, '-=1.4')
    .from('.wp-hero-title .wp-line-inner', { opacity: 0, yPercent: 120, stagger: 0.14, duration: 1.3 }, '-=1.0')
    .from('.wp-hero-sub', { opacity: 0, y: 20 }, '-=0.7')
    .from('.wp-hero-cue', { opacity: 0, y: 10 }, '-=0.5');

  // Drifting recede as you leave the hero.
  gsap.to('.wp-hero-inner', {
    opacity: 0,
    y: -80,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });
  gsap.to('.wp-hero-bg', {
    scale: 1.18,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });
}

// ── Thread ───────────────────────────────────────────────────────────────
// The opening "something in you is asking to be heard" — a single vertical
// thread (a thin line) that draws downward as the words arrive, pinned so the
// sentences assemble one at a time over a still frame.
function initThread() {
  const sec = document.querySelector<HTMLElement>('.wp-thread');
  if (!sec) return;
  const lines = gsap.utils.toArray<HTMLElement>('.wp-thread .wp-thread-line');
  if (!lines.length) return;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: sec,
      start: 'top top',
      end: '+=' + Math.max(lines.length * 60, 220) + '%',
      scrub: 0.6,
      pin: true,
      anticipatePin: 1,
    },
  });

  // The thread line grows the whole way down.
  tl.fromTo('.wp-thread-rope span', { scaleY: 0 }, { scaleY: 1, ease: 'none', duration: lines.length }, 0);

  lines.forEach((ln, i) => {
    tl.fromTo(
      ln,
      { opacity: 0, y: 40, filter: 'blur(6px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease },
      i,
    );
    // fade the previous line out so only the newest one holds the eye — keeps
    // the stacked lines from muddying together mid-scroll
    if (i > 0) {
      tl.to(lines[i - 1], { opacity: 0, filter: 'blur(3px)', duration: 0.5 }, i);
    }
  });
}

// ── Cinema ───────────────────────────────────────────────────────────────
// The centerpiece. A pinned, full-viewport stage. As you scroll, the backdrop
// cross-fades through a sequence of frames (the emotional arc: holding → first
// sound → release → arriving), each with a single caption that crawls up over
// it. This is the "story coming to life" beat.
function initCinema() {
  const cinema = document.querySelector<HTMLElement>('.wp-cinema');
  if (!cinema) return;
  const frames = gsap.utils.toArray<HTMLElement>('.wp-cinema-frame');
  const caps = gsap.utils.toArray<HTMLElement>('.wp-cinema-cap');
  if (frames.length < 2) return;

  // Stack the frames; first is visible, rest hidden, all absolutely positioned
  // by CSS. We animate opacity + a slow ken-burns scale per frame.
  gsap.set(frames, { opacity: 0 });
  gsap.set(frames[0], { opacity: 1 });
  gsap.set(caps, { opacity: 0, y: 30 });

  const perFrame = 1; // timeline units per frame
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: cinema,
      start: 'top top',
      end: '+=' + frames.length * 80 + '%',
      scrub: 0.5,
      pin: true,
      anticipatePin: 1,
    },
  });

  frames.forEach((frame, i) => {
    const at = i * perFrame;
    const img = frame.querySelector('img');
    // Ken-burns drift across the whole time this frame is on screen.
    if (img) {
      gsap.set(img, { scale: 1.08, transformOrigin: i % 2 ? 'left center' : 'right center' });
      tl.to(img, { scale: 1.16, ease: 'none', duration: perFrame * 1.4 }, at);
    }
    if (i > 0) {
      // cross-fade in from the previous
      tl.to(frames[i - 1], { opacity: 0, duration: perFrame * 0.5 }, at);
      tl.to(frame, { opacity: 1, duration: perFrame * 0.5 }, at);
    }
    // caption crawl: in, hold, out
    if (caps[i]) {
      tl.to(caps[i], { opacity: 1, y: 0, duration: perFrame * 0.4, ease }, at + perFrame * 0.12);
      tl.to(caps[i], { opacity: 0, y: -28, duration: perFrame * 0.4, ease }, at + perFrame * 0.72);
    }
  });
}

// ── Method — the three pillars, revealed as a triptych ─────────────────────
function initMethod() {
  const sec = document.querySelector<HTMLElement>('.wp-method');
  if (!sec) return;
  const cards = gsap.utils.toArray<HTMLElement>('.wp-method-card');
  if (!cards.length) return;
  gsap.from(cards, {
    opacity: 0,
    y: 56,
    duration: 0.9,
    stagger: 0.16,
    ease,
    scrollTrigger: { trigger: sec, start: 'top 72%' },
  });
}

// ── Layered parallax ───────────────────────────────────────────────────────
// Any element with data-parallax drifts at its own speed relative to scroll.
function initParallax() {
  gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
    const speed = parseFloat(el.dataset.parallax || '0.2');
    gsap.to(el, {
      yPercent: -speed * 100,
      ease: 'none',
      scrollTrigger: {
        trigger: el.closest('[data-parallax-scope]') || el,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });
}

// ── Generic rises / fades ──────────────────────────────────────────────────
function initRises() {
  gsap.utils.toArray<HTMLElement>('.wp-rise').forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      y: 40,
      duration: 0.9,
      ease,
      scrollTrigger: { trigger: el, start: 'top 84%' },
    });
  });
  gsap.utils.toArray<HTMLElement>('.wp-fade').forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      duration: 1.2,
      ease,
      scrollTrigger: { trigger: el, start: 'top 84%' },
    });
  });
}

// ── Line crawls ────────────────────────────────────────────────────────────
// Blocks marked .wp-crawl reveal their child .wp-line elements one after
// another as the block scrolls through, each rising and un-blurring — the
// "text assembling itself" feel.
function initLineCrawls() {
  gsap.utils.toArray<HTMLElement>('.wp-crawl').forEach((block) => {
    const lines = block.querySelectorAll<HTMLElement>('.wp-line');
    if (!lines.length) return;
    gsap.from(lines, {
      opacity: 0,
      y: 28,
      filter: 'blur(5px)',
      duration: 0.8,
      stagger: 0.18,
      ease,
      scrollTrigger: { trigger: block, start: 'top 78%' },
    });
  });
}

// ── Scroll progress rail ───────────────────────────────────────────────────
function initProgress() {
  const bar = document.querySelector<HTMLElement>('.wp-progress span');
  if (!bar) return;
  gsap.to(bar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { start: 'top top', end: 'bottom bottom', scrub: true },
  });
}
