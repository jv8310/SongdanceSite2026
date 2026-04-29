import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const heroTimeline = gsap.timeline({ defaults: { ease: 'power3.out' } });

heroTimeline
  .from('[data-anim="title"]', { y: 60, opacity: 0, duration: 1 })
  .from('[data-anim="subtitle"]', { y: 30, opacity: 0, duration: 0.8 }, '-=0.5')
  .from('[data-anim="cta"]', { y: 20, opacity: 0, duration: 0.6 }, '-=0.4');

gsap.from('[data-anim="reveal"]', {
  scrollTrigger: {
    trigger: '[data-anim="reveal"]',
    start: 'top 80%',
  },
  y: 40,
  opacity: 0,
  duration: 0.9,
  ease: 'power2.out',
});

gsap.utils.toArray<HTMLElement>('[data-anim="card"]').forEach((card, i) => {
  gsap.from(card, {
    scrollTrigger: {
      trigger: card,
      start: 'top 85%',
    },
    y: 50,
    opacity: 0,
    duration: 0.7,
    delay: i * 0.1,
    ease: 'power2.out',
  });
});
