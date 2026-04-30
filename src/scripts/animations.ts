import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ease = 'power2.out';
const slow = 0.9;
const breath = 1.4;

const fadeOnly = (target: gsap.TweenTarget, vars: gsap.TweenVars = {}) =>
  gsap.from(target, { opacity: 0, duration: slow, ease, ...vars });

const rise = (target: gsap.TweenTarget, vars: gsap.TweenVars = {}) =>
  reduceMotion
    ? fadeOnly(target, vars)
    : gsap.from(target, { y: 32, opacity: 0, duration: slow, ease, ...vars });

// Hero — entrance timeline (above the fold, no scroll trigger)
const hero = gsap.timeline({ defaults: { ease, duration: slow } });
hero
  .from('[data-anim="hero-eyebrow"]', { opacity: 0, y: reduceMotion ? 0 : 12 })
  .from(
    '[data-anim="hero-head"]',
    { opacity: 0, y: reduceMotion ? 0 : 28, duration: breath },
    '-=0.55'
  )
  .from('[data-anim="hero-sub"]', { opacity: 0, y: reduceMotion ? 0 : 18 }, '-=0.7')
  .from('[data-anim="hero-cta"]', { opacity: 0, y: reduceMotion ? 0 : 14 }, '-=0.6')
  .from(
    '[data-anim="hero-img-primary"]',
    { opacity: 0, scale: reduceMotion ? 1 : 1.04, duration: breath },
    '-=1.1'
  )
  .from(
    '[data-anim="hero-img-secondary"]',
    { opacity: 0, y: reduceMotion ? 0 : 24, duration: breath },
    '-=1.2'
  )
  .from(
    '[data-anim="hero-stamp"]',
    { opacity: 0, rotation: reduceMotion ? -8 : -24, scale: reduceMotion ? 1 : 0.6, duration: breath },
    '-=1.0'
  );

// Ambient drift on the hero stamp — like candlelight, never wiggle
if (!reduceMotion) {
  gsap.to('[data-anim="hero-stamp"]', {
    rotation: -6,
    duration: 6,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

// Generic reveal — section heads, lyric breaks, newsletter
gsap.utils.toArray<HTMLElement>('[data-anim="reveal"]').forEach((el) => {
  rise(el, {
    scrollTrigger: { trigger: el, start: 'top 82%' },
  });
});

// Lyric break — fade only, slowest
gsap.utils.toArray<HTMLElement>('[data-anim="lyric"]').forEach((el) => {
  fadeOnly(el, {
    duration: breath,
    scrollTrigger: { trigger: el, start: 'top 82%' },
  });
});

// Work rows — staggered children
gsap.utils.toArray<HTMLElement>('[data-anim="work-row"]').forEach((row) => {
  const text = row.querySelector('.sd-work-row-text');
  const img = row.querySelector('.sd-work-row-img');
  const tl = gsap.timeline({
    defaults: { ease, duration: slow },
    scrollTrigger: { trigger: row, start: 'top 78%' },
  });
  if (img) tl.from(img, { opacity: 0, y: reduceMotion ? 0 : 36, duration: breath });
  if (text) tl.from(text, { opacity: 0, y: reduceMotion ? 0 : 22 }, '-=0.7');
});

// Offering cards — gentle staggered rise
gsap.utils.toArray<HTMLElement>('[data-anim="offering"]').forEach((card, i) => {
  rise(card, {
    delay: i * 0.08,
    scrollTrigger: { trigger: card, start: 'top 88%' },
  });
});

// Gallery items — fade up with small stagger
gsap.utils.toArray<HTMLElement>('[data-anim="gallery-item"]').forEach((item, i) => {
  rise(item, {
    delay: i * 0.06,
    scrollTrigger: { trigger: item, start: 'top 90%' },
  });
});

// Lineage — portrait then text
const lineagePortrait = document.querySelector<HTMLElement>('[data-anim="lineage-portrait"]');
const lineageText = document.querySelector<HTMLElement>('[data-anim="lineage-text"]');
if (lineagePortrait && lineageText) {
  const tl = gsap.timeline({
    defaults: { ease, duration: breath },
    scrollTrigger: { trigger: lineagePortrait, start: 'top 78%' },
  });
  tl.from(lineagePortrait, { opacity: 0, y: reduceMotion ? 0 : 32 });
  tl.from(lineageText, { opacity: 0, y: reduceMotion ? 0 : 22 }, '-=0.9');
}

// Retreat band — text then side list
const retreatText = document.querySelector<HTMLElement>('[data-anim="retreat-text"]');
const retreatSide = document.querySelector<HTMLElement>('[data-anim="retreat-side"]');
if (retreatText && retreatSide) {
  const tl = gsap.timeline({
    defaults: { ease, duration: breath },
    scrollTrigger: { trigger: retreatText, start: 'top 78%' },
  });
  tl.from(retreatText, { opacity: 0, y: reduceMotion ? 0 : 28 });
  tl.from(retreatSide.children, { opacity: 0, y: reduceMotion ? 0 : 16, stagger: 0.08, duration: slow }, '-=0.9');
}

// Slow ambient scale on hero primary image — candlelight breath
if (!reduceMotion) {
  gsap.to('[data-anim="hero-img-primary"] img', {
    scale: 1.02,
    duration: 12,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}
