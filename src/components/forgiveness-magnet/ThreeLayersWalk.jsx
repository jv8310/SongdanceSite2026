import React from 'react';
import HeroIntro from './HeroIntro.jsx';

// =============================================================
// Three Layers, A Walk Through
// Part 0: hero (pre-page)
// Part 1: scroll-driven theory (you ↔ other ↔ self ↔ wholeness)
// Part 2: interactive practice with explicit Continue buttons
// =============================================================

const LAYER1_CHIPS = ['father', 'mother', 'ex-partner', 'a friend', 'a sibling', 'myself', 'someone'];
const LAYER2_CHIPS = ['the silence', 'the anger', 'what I said', "what I didn't say", 'the leaving', 'my choices', 'the hiding'];

const FALLBACK_PRACTICE = {
  toward1: 'everyone I have not yet been able to forgive',
  toward2: 'the part of me that has felt unforgivable',
  closing: 'There was never anything to forgive.',
  isFallback: true,
};

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// =============================================================
// Scroll Theory
// =============================================================

function ScrollTheory({ onBegin }) {
  const scrollerRef = React.useRef(null);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = clamp(-rect.top / total, 0, 1);
      setProgress(p);
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const p = progress;

  let scene = 0;
  if (p < 0.08) scene = 0;
  else if (p < 0.32) scene = 1;
  else if (p < 0.55) scene = 2;
  else if (p < 0.82) scene = 3;
  else scene = 4;

  const youOpacity = p < 0.78
    ? 1
    : clamp(1 - (p - 0.78) / 0.10, 0, 1);

  const youX = (() => {
    const t = clamp((p - 0.04) / 0.20, 0, 1);
    const t2 = clamp((p - 0.45) / 0.10, 0, 1);
    return lerp(0, -90, easeInOut(t)) * (1 - easeInOut(t2));
  })();

  const otherOpacity = (() => {
    if (p < 0.06) return 0;
    if (p < 0.18) return clamp((p - 0.06) / 0.12, 0, 1);
    if (p < 0.42) return 1;
    if (p < 0.55) return clamp(1 - (p - 0.42) / 0.13, 0, 1);
    return 0;
  })();
  const otherX = (() => {
    const arrival = clamp((p - 0.06) / 0.12, 0, 1);
    const departure = clamp((p - 0.42) / 0.13, 0, 1);
    const stayX = lerp(260, 90, easeInOut(arrival));
    return lerp(stayX, 260, easeInOut(departure));
  })();

  const streamOuter = (() => {
    const t = clamp((p - 0.16) / 0.16, 0, 1);
    const fade = clamp(1 - (p - 0.36) / 0.06, 0, 1);
    return { opacity: easeInOut(t) * fade * 0.95, width: 180 };
  })();

  const selfOpacity = (() => {
    if (p < 0.50) return 0;
    if (p < 0.60) return clamp((p - 0.50) / 0.10, 0, 1);
    if (p < 0.78) return 1;
    return clamp(1 - (p - 0.78) / 0.08, 0, 1);
  })();
  const selfX = (() => {
    const arrival = clamp((p - 0.50) / 0.10, 0, 1);
    return lerp(-260, -90, easeInOut(arrival));
  })();

  const youXLayer2 = (() => {
    const t = clamp((p - 0.55) / 0.08, 0, 1);
    const dissolve = clamp((p - 0.78) / 0.08, 0, 1);
    return lerp(0, 60, easeInOut(t)) * (1 - dissolve);
  })();

  const streamInner = (() => {
    if (p < 0.58) return { opacity: 0 };
    const t = clamp((p - 0.58) / 0.10, 0, 1);
    const fade = clamp(1 - (p - 0.78) / 0.06, 0, 1);
    return { opacity: easeInOut(t) * fade * 0.95 };
  })();

  const youCombinedX = youX + youXLayer2;

  const introOpacity = clamp(1 - p / 0.06, 0, 1);

  const youStyle = {
    '--x': `${youCombinedX}px`,
    '--opacity': youOpacity,
    '--scale': 1,
  };
  const otherStyle = {
    '--x': `${otherX}px`,
    '--opacity': otherOpacity,
    '--scale': 1,
  };
  const selfStyle = {
    '--x': `${selfX}px`,
    '--opacity': selfOpacity,
    '--scale': 1,
  };
  const streamStyle = {
    '--stream-w': `${streamOuter.width}px`,
    '--stream-opacity': streamOuter.opacity,
    transform: `translate(calc(-50% + ${(youCombinedX + otherX) / 2}px), -50%)`,
  };
  const innerStreamStyle = {
    '--stream-w': '180px',
    '--stream-opacity': streamInner.opacity,
    transform: `translate(calc(-50% + ${(youCombinedX + selfX) / 2}px), -50%)`,
  };

  return (
    <div className="tlw-theory" ref={scrollerRef}>
      <div className="tlw-scroller">
        <div className="tlw-stage">
          <div className="tlw-scroll-intro" style={{ '--intro-opacity': introOpacity }}>
            <div className="tlw-scroll-intro-eyebrow">three layers · a walk through</div>
            <p className="tlw-scroll-intro-title">
              Three movements, before the practice. Scroll slowly.
            </p>
            <div className="tlw-scroll-cue">
              <div className="tlw-scroll-cue-line" />
              scroll
            </div>
          </div>

          <div className="tlw-canvas">
            <div className="tlw-figure" data-variant="self" style={selfStyle}>
              <div className="tlw-figure-halo" />
              <PersonSVG />
              <span className="tlw-figure-label" style={{ '--label-opacity': clamp(selfOpacity, 0, 1) }}>
                self
              </span>
            </div>

            <div className="tlw-figure" data-variant="you" style={youStyle}>
              <div className="tlw-figure-halo" />
              <PersonSVG />
              <span className="tlw-figure-label" style={{ '--label-opacity': clamp(youOpacity, 0, 1) }}>
                you
              </span>
            </div>

            <div className="tlw-figure" data-variant="other" style={otherStyle}>
              <div className="tlw-figure-halo" />
              <PersonSVG />
              <span className="tlw-figure-label" style={{ '--label-opacity': clamp(otherOpacity, 0, 1) }}>
                other
              </span>
            </div>

            <div className="tlw-stream" style={streamStyle}>
              <div className="tlw-stream-track" />
            </div>

            <div className="tlw-stream" style={innerStreamStyle}>
              <div className="tlw-stream-track" />
            </div>

            <div className="tlw-captions">
              <div className="tlw-caption" data-active={scene === 0 ? 'true' : 'false'}>
                <span className="tlw-caption-eyebrow">begin here</span>
                <p className="tlw-caption-text">
                  You arrive. Just <em>you</em>, just for a moment.
                </p>
              </div>
              <div className="tlw-caption" data-active={scene === 1 ? 'true' : 'false'}>
                <span className="tlw-caption-eyebrow">layer one · others</span>
                <p className="tlw-caption-text">
                  Forgiveness moves outward — <em>toward someone</em> you have not yet been able to release.
                </p>
              </div>
              <div className="tlw-caption" data-active={scene === 2 ? 'true' : 'false'}>
                <span className="tlw-caption-eyebrow">turning</span>
                <p className="tlw-caption-text">
                  Now turn. There is something <em>in you</em> waiting to be met.
                </p>
              </div>
              <div className="tlw-caption" data-active={scene === 3 ? 'true' : 'false'}>
                <span className="tlw-caption-eyebrow">layer two · self</span>
                <p className="tlw-caption-text">
                  Forgiveness moves between you and <em>the part of you</em> that has felt unforgivable.
                </p>
              </div>
              <div className="tlw-caption" data-active={scene === 4 ? 'true' : 'false'}>
                <span className="tlw-caption-eyebrow">layer three · separation</span>
                <p className="tlw-caption-text">
                  And what if there were never <em>two</em> at all?
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="tlw-begin">
        <div className="tlw-begin-eyebrow">now, the practice</div>
        <button className="tlw-btn tlw-btn-primary tlw-btn-large" onClick={onBegin}>
          Begin <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

// =============================================================
// Practice Orb
// =============================================================

function Orb({ layer, rippleKey }) {
  const motes = React.useMemo(() => {
    const presets = [
      { r: 130, dur: 14, delay: 0 },
      { r: 145, dur: 18, delay: -3 },
      { r: 120, dur: 22, delay: -7 },
      { r: 155, dur: 16, delay: -1 },
      { r: 110, dur: 20, delay: -10 },
      { r: 138, dur: 24, delay: -4 },
    ];
    return presets.map((p, i) => ({
      key: i,
      style: {
        '--mote-r': `${p.r}px`,
        '--mote-dur': `${p.dur}s`,
        '--mote-delay': `${p.delay}s`,
      },
    }));
  }, []);

  return (
    <div className="tlw-orb-wrap" aria-hidden="true">
      <div className="tlw-orb-halo" />
      {motes.map((m) => (
        <span key={m.key} className="tlw-orb-mote" style={m.style} />
      ))}
      <div className="tlw-orb" data-layer={layer}>
        <div className="tlw-orb-current" />
        <div className="tlw-orb-current reverse" />
        <div className="tlw-orb-inner" />
        {rippleKey > 0 ? <span key={rippleKey} className="tlw-orb-ripple" /> : null}
      </div>
    </div>
  );
}

// =============================================================
// Steps
// =============================================================

function Chips({ options, value, onPick }) {
  return (
    <div className="tlw-chips" role="listbox" aria-label="Suggested words">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className="tlw-chip"
          data-active={value === opt ? 'true' : 'false'}
          onClick={() => onPick(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ProgressDots({ step }) {
  const states = [0, 1, 2].map((i) => {
    if (step > i) return { active: false, done: true };
    if (step === i) return { active: true, done: false };
    return { active: false, done: false };
  });
  return (
    <div className="tlw-progress" aria-hidden="true">
      {states.map((s, i) => (
        <span
          key={i}
          className="tlw-progress-dot"
          data-active={s.active ? 'true' : 'false'}
          data-done={s.done ? 'true' : 'false'}
        />
      ))}
    </div>
  );
}

function Step1({ word, setWord, onContinue, onRipple }) {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <div className="tlw-layer-eyebrow">layer one · others</div>
      <h2 className="tlw-prompt"><em>Bring to mind someone you find hard to forgive.</em></h2>
      <div className="tlw-input-row">
        <input
          className="tlw-input"
          type="text"
          value={word}
          onChange={(e) => {
            const v = e.target.value.slice(0, 40);
            setWord(v);
            if (v.length > word.length) onRipple();
          }}
          placeholder="one word — a name, a role…"
          maxLength={40}
          autoFocus
        />
      </div>
      <Chips options={LAYER1_CHIPS} value={word} onPick={(v) => { setWord(v); onRipple(); }} />
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-primary" onClick={onContinue}>
          Continue <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function TransitionStep({ eyebrow, text, onContinue }) {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      {eyebrow ? <div className="tlw-layer-eyebrow">{eyebrow}</div> : null}
      <p className="tlw-transition">{text}</p>
      <p className="tlw-transition" style={{ fontFamily: 'var(--font-body)', fontStyle: 'normal', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--ink-quiet)', maxWidth: '32ch' }}>
        Take a slow breath. When you're ready —
      </p>
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-ghost" onClick={onContinue}>
          Continue <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function Step2({ word, setWord, onContinue, onRipple }) {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <div className="tlw-layer-eyebrow">layer two · self</div>
      <h2 className="tlw-prompt">Now: what in yourself feels <em>unforgivable?</em></h2>
      <div className="tlw-input-row">
        <input
          className="tlw-input"
          type="text"
          value={word}
          onChange={(e) => {
            const v = e.target.value.slice(0, 40);
            setWord(v);
            if (v.length > word.length) onRipple();
          }}
          placeholder="one word — a quality, a moment…"
          maxLength={40}
          autoFocus
        />
      </div>
      <Chips options={LAYER2_CHIPS} value={word} onPick={(v) => { setWord(v); onRipple(); }} />
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-primary" onClick={onContinue}>
          Continue <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function Step3({ onGenerate }) {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <div className="tlw-layer-eyebrow">layer three · separation</div>
      <div className="tlw-prompt-long">
        <span className="tlw-instruction">Don't type anything. Read this slowly.</span>
        <p>What if the entire premise — that wrong was done, that someone is on the other side of an unforgivable line — is itself a story the mind tells?</p>
        <p>Don't believe it. Don't disbelieve it. Just notice what happens in your body when the question is asked.</p>
      </div>
      <p className="tlw-transition" style={{ marginTop: 'var(--sp-3)' }}>
        This is layer three. The forgiveness of separation itself.
      </p>
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-primary tlw-btn-large" onClick={onGenerate}>
          Receive your forgiveness practice <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function Generating() {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <p className="tlw-generating">A practice is being shaped for you…</p>
    </div>
  );
}

function PracticeAndEmail({ practice, onSubmitEmail, onReplay, infoOpen, setInfoOpen, submitted, sending }) {
  const [email, setEmail] = React.useState('');
  const [hp, setHp] = React.useState('');
  const [error, setError] = React.useState('');

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("That doesn't look quite right. Try once more.");
      return;
    }
    setError('');
    onSubmitEmail(trimmed, hp).catch((err) => {
      setError(err?.message || "Something went wrong sending it. Try once more.");
    });
  };

  return (
    <div className="tlw-step tlw-step-fade-enter" style={{ minHeight: 0 }}>
      <div className="tlw-practice">
        <div className="tlw-practice-mark">
          <img src="/brand/symbol-orange.png" alt="" />
        </div>
        <h3>A forgiveness practice for you.</h3>
        <p className="tlw-toward">Toward {practice.toward1}, I sound:</p>
        <p className="tlw-phrases">I'm sorry. Please forgive me. Thank you. I love you.</p>
        <p className="tlw-toward">Toward {practice.toward2}, I sound:</p>
        <p className="tlw-phrases">I'm sorry. Please forgive me. Thank you. I love you.</p>
        <p className="tlw-final">{practice.closing}</p>
      </div>

      {practice.isFallback ? (
        <p className="tlw-fallback-note">A simpler version while we shape the personalized one. Refresh to try again.</p>
      ) : null}

      {submitted ? (
        <>
          <p className="tlw-confirmation">Sent. Check your inbox in a few minutes.</p>
          <p className="tlw-final-leadin">This is a taste.</p>
          <p className="tlw-final-pitch">
            The Forgiveness Course is the longer walk — 26 minutes a day for one season, with sound and guidance.
          </p>
          <p className="tlw-final-cta">
            <a href="https://site.songdance.co/forgiveness">Register for the Forgiveness Course →</a>
          </p>
        </>
      ) : (
        <form className="tlw-email-block" onSubmit={submit}>
          <p className="tlw-email-intro">
            We'll send your forgiveness practice to your inbox — a mantra to return to, whenever you need it.
          </p>
          <div className="tlw-email-form">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email address"
              required
              disabled={sending}
            />
            <button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send it to me'}</button>
          </div>
          <input
            type="text"
            name="company"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
          />
          {error ? <p className="tlw-email-error">{error}</p> : null}
        </form>
      )}

      <div className="tlw-actions">
        <button className="tlw-btn tlw-btn-quiet" onClick={() => setInfoOpen(!infoOpen)}>
          What does it mean to "sound" these phrases?
        </button>
      </div>
      {infoOpen ? (
        <div className="tlw-info">
          <p>
            To <em>sound</em> a phrase is not to sing it, and not only to think it.
            It is to let the words leave your body on breath — quiet or full, alone in a room — and to listen
            for what they touch on the way out. The four phrases of ho'oponopono carry no claim on the outcome.
            They are simply offered. What changes is the one who offers them.
          </p>
        </div>
      ) : null}

      <button className="tlw-replay" onClick={onReplay}>
        ↻ walk the layers again
      </button>
    </div>
  );
}

function parsePractice(md) {
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean);
  const towards = [];
  let closing = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\*\*/g, '');
    const m = l.match(/^Toward\s+(.+?)[:.]?\s*$/i);
    if (m && !/separation/i.test(m[1])) {
      const phrase = m[1].replace(/,?\s*I sound\s*$/i, '').replace(/[,.]$/, '').trim();
      towards.push(phrase);
    } else if (/^there was never anything to forgive\.?$/i.test(l.replace(/\*/g, ''))) {
      closing = 'There was never anything to forgive.';
    }
  }
  return {
    toward1: towards[0] || FALLBACK_PRACTICE.toward1,
    toward2: towards[1] || FALLBACK_PRACTICE.toward2,
    closing: closing || FALLBACK_PRACTICE.closing,
  };
}

// =============================================================
// Practice container
// =============================================================

function PracticeFlow({ startKey, onReplay }) {
  const [step, setStep] = React.useState('l1');
  const [othersWord, setOthersWord] = React.useState('');
  const [selfWord, setSelfWord] = React.useState('');
  const [practice, setPractice] = React.useState(null);
  const [rippleKey, setRippleKey] = React.useState(0);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    setStep('l1');
    setOthersWord('');
    setSelfWord('');
    setPractice(null);
    setInfoOpen(false);
    setSubmitted(false);
    setSending(false);
    setRippleKey(0);
  }, [startKey]);

  const triggerRipple = React.useCallback(() => setRippleKey((k) => k + 1), []);

  const orbLayer = React.useMemo(() => {
    if (step === 'l1' || step === 't1') return '1';
    if (step === 'l2' || step === 't2') return '2';
    if (step === 'l3') return '3';
    if (step === 'generating') return 'generating';
    return 'complete';
  }, [step]);

  const generate = async () => {
    setStep('generating');
    try {
      const res = await fetch('/api/forgiveness-mantra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otherWord: othersWord, selfWord }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!res.ok || data.fallback) {
        setPractice({ ...FALLBACK_PRACTICE });
      } else if (data.text) {
        const parsed = parsePractice(data.text);
        setPractice({ ...parsed, isFallback: false });
      } else if (data.toward1 && data.toward2 && data.closing) {
        setPractice({ toward1: data.toward1, toward2: data.toward2, closing: data.closing, isFallback: false });
      } else {
        setPractice({ ...FALLBACK_PRACTICE });
      }
    } catch (err) {
      console.warn('Forgiveness practice fallback:', err);
      setPractice({ ...FALLBACK_PRACTICE });
    }
    setStep('practice');
  };

  const submitEmail = async (email, hp) => {
    const mantraText = practice ? [
      'A forgiveness practice for you.',
      '',
      `Toward ${practice.toward1}, I sound:`,
      "I'm sorry. Please forgive me. Thank you. I love you.",
      '',
      `Toward ${practice.toward2}, I sound:`,
      "I'm sorry. Please forgive me. Thank you. I love you.",
      '',
      practice.closing,
    ].join('\n') : '';

    setSending(true);
    try {
      const res = await fetch('/api/forgiveness-deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otherWord: othersWord || '',
          selfWord: selfWord || '',
          mantra: mantraText,
          hp: hp || '',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error("Couldn't send it just now. Try once more.");
      }
      setSubmitted(true);
    } finally {
      setSending(false);
    }
  };

  let body = null;
  if (step === 'l1') {
    body = (
      <Step1 key="l1" word={othersWord} setWord={setOthersWord}
        onContinue={() => setStep('t1')} onRipple={triggerRipple} />
    );
  } else if (step === 't1') {
    body = (
      <TransitionStep key="t1"
        eyebrow="layer one · settling"
        text="Hold them in your awareness. Notice what your body carries toward them. This is layer one."
        onContinue={() => setStep('l2')} />
    );
  } else if (step === 'l2') {
    body = (
      <Step2 key="l2" word={selfWord} setWord={setSelfWord}
        onContinue={() => setStep('t2')} onRipple={triggerRipple} />
    );
  } else if (step === 't2') {
    body = (
      <TransitionStep key="t2"
        eyebrow="layer two · settling"
        text="Hold this part of yourself in awareness. Meet it. This is layer two."
        onContinue={() => setStep('l3')} />
    );
  } else if (step === 'l3') {
    body = <Step3 key="l3" onGenerate={generate} />;
  } else if (step === 'generating') {
    body = <Generating key="g" />;
  } else if (step === 'practice') {
    body = (
      <PracticeAndEmail key="p" practice={practice}
        onSubmitEmail={submitEmail}
        onReplay={onReplay}
        infoOpen={infoOpen}
        setInfoOpen={setInfoOpen}
        submitted={submitted}
        sending={sending} />
    );
  }

  const progressStep = (() => {
    if (step === 'l1') return 0;
    if (step === 't1' || step === 'l2') return 1;
    if (step === 't2' || step === 'l3') return 2;
    return 3;
  })();

  return (
    <section className="tlw-practice-section">
      <div className="tlw-inner">
        <Orb layer={orbLayer} rippleKey={rippleKey} />
        {body}
        {step !== 'practice' ? <ProgressDots step={progressStep} /> : null}
      </div>
    </section>
  );
}

// =============================================================
// Top-level
// =============================================================

export default function ThreeLayersWalk() {
  const practiceRef = React.useRef(null);
  const [practiceVisible, setPracticeVisible] = React.useState(false);
  const [startKey, setStartKey] = React.useState(0);

  const begin = () => {
    setPracticeVisible(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        practiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  const scrollToTheory = () => {
    document.querySelector('.tlw-theory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const replay = () => {
    setStartKey((k) => k + 1);
    document.querySelector('.tlw-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="tlw-section">
      <HeroIntro onBegin={begin} onScrollToTheory={scrollToTheory} />
      <ScrollTheory onBegin={begin} />
      <div ref={practiceRef}>
        {practiceVisible ? <PracticeFlow startKey={startKey} onReplay={replay} /> : null}
      </div>
    </section>
  );
}

// =============================================================
// Figure — seated meditator (single locked variant)
// =============================================================

function FigureDefs() {
  return (
    <defs>
      <radialGradient id="tlw-heart-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="rgba(201, 96, 58, 0.7)" />
        <stop offset="55%" stopColor="rgba(201, 96, 58, 0.22)" />
        <stop offset="100%" stopColor="rgba(201, 96, 58, 0)" />
      </radialGradient>
      <filter id="tlw-ink-edge" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="0.4" />
      </filter>
    </defs>
  );
}

function PersonSVG() {
  const seatedPath = "M 70 50 C 80 50, 87 58, 87 68 C 87 76, 84 82, 80 86 C 84 90, 92 96, 98 106 C 104 118, 106 130, 104 142 C 102 150, 100 156, 100 162 C 102 170, 110 182, 118 196 C 126 210, 132 220, 130 224 C 128 228, 122 229, 114 229 L 26 229 C 18 229, 12 228, 10 224 C 8 220, 14 210, 22 196 C 30 182, 38 170, 40 162 C 40 156, 38 150, 36 142 C 34 130, 36 118, 42 106 C 48 96, 56 90, 60 86 C 56 82, 53 76, 53 68 C 53 58, 60 50, 70 50 Z";
  return (
    <svg className="tlw-figure-svg" viewBox="0 0 140 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <FigureDefs />
      <ellipse className="heart-glow" cx="70" cy="148" rx="44" ry="32" fill="url(#tlw-heart-glow)" />
      <path className="ink-stroke" filter="url(#tlw-ink-edge)" d={seatedPath} />
      <path className="ink-stroke-shadow" d={seatedPath} />
      <circle className="heart-core" cx="70" cy="148" r="3" />
    </svg>
  );
}
