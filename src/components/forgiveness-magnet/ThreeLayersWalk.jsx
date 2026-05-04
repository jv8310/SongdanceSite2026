import React from 'react';
import { composePrayer, Q4_LABEL, NAMING_PATTERNS } from '../../lib/forgiveness-prayer.ts';

// =============================================================
// Forgiveness — quiz → composed prayer → email → Drip
// Five questions shape a free-verse prayer that meets the
// visitor at their dominant center (body / heart / head).
// =============================================================

const Q2_OPTIONS = [
  { value: 'body',  label: 'A tightness, heaviness, or charge somewhere in my body — jaw, chest, gut, shoulders' },
  { value: 'heart', label: 'An ache, a heartbreak, a longing — something broken between us, or in me' },
  { value: 'head',  label: 'A loop of thoughts — replaying it, analyzing, trying to understand what happened' },
  { value: 'mix',   label: "A mix, or I'm not sure" },
];

const Q3_OPTIONS = [
  { value: 'body',  label: 'To let go. To stop carrying this. To put it down.' },
  { value: 'heart', label: 'To be seen. To grieve it properly. To feel love again.' },
  { value: 'head',  label: "To understand. To make sense of it. To know it's safe to move on." },
];

const Q4_OPTIONS = [
  { value: 'hurt_by',   label: Q4_LABEL.hurt_by },
  { value: 'hurt_them', label: Q4_LABEL.hurt_them },
  { value: 'mutual',    label: Q4_LABEL.mutual },
  { value: 'self',      label: Q4_LABEL.self },
  { value: 'life',      label: Q4_LABEL.life },
];

const Q5_OPTIONS = [
  { value: 'resistant',     label: "I want to forgive but I'm not there yet — there's still anger or resistance" },
  { value: 'head_not_body', label: "I've forgiven in my head but not in my body" },
  { value: 'returns',       label: 'I keep forgiving and it keeps coming back' },
  { value: 'ready',         label: "I'm ready — I just need words for it" },
  { value: 'numb',          label: 'I feel numb, distant, or shut down about it' },
];

const STEPS = ['intro', 'q1', 'q2', 'q3', 'q4', 'q5', 'generating', 'prayer'];

// =============================================================
// Orb (kept from prior design — simpler now, no layer states)
// =============================================================

function Orb({ shimmer, rippleKey }) {
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
      <div className="tlw-orb" data-layer={shimmer ? 'generating' : '1'}>
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

function Intro({ onBegin }) {
  return (
    <div className="tlw-step tlw-step-fade-enter tlw-intro">
      <h1 className="tlw-intro-title">A Personalized Forgiveness Prayer</h1>
      <p className="tlw-intro-body">
        Forgiveness isn't a single act — it's a process. Something acknowledged. Something released. Something honored. Something returned to.
      </p>
      <p className="tlw-intro-body">
        The questions below help shape a prayer that meets you where you actually are. Take your time. There are no wrong answers, and what you write stays private — it only shapes the prayer you receive.
      </p>
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-primary tlw-btn-large" onClick={onBegin}>
          Begin <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function Q1Step({ value, setValue, onContinue, onRipple }) {
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current?.focus(); }, []);
  const previous = React.useRef(value);
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <div className="tlw-layer-eyebrow">the story</div>
      <h2 className="tlw-prompt">In a few sentences, tell us what you're seeking forgiveness around.</h2>
      <p className="tlw-q-helper">Who or what is involved? Write as little or as much as feels right.</p>
      <textarea
        ref={ref}
        className="tlw-q-textarea"
        value={value}
        maxLength={500}
        onChange={(e) => {
          const v = e.target.value.slice(0, 500);
          if (v.length > previous.current.length) onRipple();
          previous.current = v;
          setValue(v);
        }}
        placeholder="I'm holding something around…"
        rows={5}
      />
      <div className="tlw-btn-row">
        <button className="tlw-btn tlw-btn-primary" disabled={!value.trim()} onClick={onContinue}>
          Continue <i className="ph-light ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
}

function ChoiceStep({ eyebrow, prompt, options, value, onPick }) {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <div className="tlw-layer-eyebrow">{eyebrow}</div>
      <h2 className="tlw-prompt">{prompt}</h2>
      <div className="tlw-choices" role="radiogroup">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value ? 'true' : 'false'}
            className="tlw-choice"
            data-active={value === opt.value ? 'true' : 'false'}
            onClick={() => onPick(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Generating() {
  return (
    <div className="tlw-step tlw-step-fade-enter">
      <p className="tlw-generating">A prayer is being shaped for you…</p>
    </div>
  );
}

function PrayerCard({ prayer, onSubmitEmail, onReplay, submitted, sending }) {
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
        <h3>A forgiveness prayer for you.</h3>
        <p className="tlw-prayer-body">{prayer}</p>
      </div>

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
            We'll send your prayer to your inbox — to return to, whenever you need it.
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

      <button className="tlw-replay" onClick={onReplay}>
        ↻ begin again
      </button>
    </div>
  );
}

function ProgressDots({ index, total }) {
  return (
    <div className="tlw-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="tlw-progress-dot"
          data-active={i === index ? 'true' : 'false'}
          data-done={i < index ? 'true' : 'false'}
        />
      ))}
    </div>
  );
}

// =============================================================
// Top-level
// =============================================================

export default function ThreeLayersWalk() {
  const [step, setStep] = React.useState('intro');
  const [answers, setAnswers] = React.useState({ q1: '', q2: null, q3: null, q4: null, q5: null });
  const [prayer, setPrayer] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [rippleKey, setRippleKey] = React.useState(0);

  const triggerRipple = React.useCallback(() => setRippleKey((k) => k + 1), []);

  const replay = () => {
    setStep('intro');
    setAnswers({ q1: '', q2: null, q3: null, q4: null, q5: null });
    setPrayer(null);
    setSubmitted(false);
    setSending(false);
  };

  // Pick a choice and auto-advance to the next step after a brief beat.
  const pickAndAdvance = (key, next) => (value) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    triggerRipple();
    window.setTimeout(() => setStep(next), 260);
  };

  const generate = React.useCallback(async () => {
    setStep('generating');
    let namingLine;
    try {
      const res = await fetch('/api/forgiveness-prayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q1: answers.q1, q4: answers.q4 }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.fallback && typeof data.namingLine === 'string') {
        namingLine = data.namingLine;
      }
    } catch (err) {
      console.warn('Naming-line fallback:', err);
    }
    const composed = composePrayer(answers, namingLine);
    setPrayer(composed);
    setStep('prayer');
  }, [answers]);

  React.useEffect(() => {
    if (step === 'q5' && answers.q5) {
      generate();
    }
  }, [answers.q5, step, generate]);

  const submitEmail = async (email, hp) => {
    setSending(true);
    try {
      const res = await fetch('/api/forgiveness-deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          situation: answers.q1 || '',
          relationship: answers.q4 ? Q4_LABEL[answers.q4] : '',
          prayer: prayer?.prayer || '',
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
  let stepIndex = 0;
  if (step === 'intro') {
    body = <Intro key="intro" onBegin={() => setStep('q1')} />;
    stepIndex = 0;
  } else if (step === 'q1') {
    body = (
      <Q1Step
        key="q1"
        value={answers.q1}
        setValue={(v) => setAnswers((a) => ({ ...a, q1: v }))}
        onContinue={() => { triggerRipple(); setStep('q2'); }}
        onRipple={triggerRipple}
      />
    );
    stepIndex = 1;
  } else if (step === 'q2') {
    body = (
      <ChoiceStep
        key="q2"
        eyebrow="where the wound lives now"
        prompt="When you bring this situation to mind right now, where do you feel it most?"
        options={Q2_OPTIONS}
        value={answers.q2}
        onPick={pickAndAdvance('q2', 'q3')}
      />
    );
    stepIndex = 2;
  } else if (step === 'q3') {
    body = (
      <ChoiceStep
        key="q3"
        eyebrow="what this part of you most wants"
        prompt="If this wound could speak, what would it ask for?"
        options={Q3_OPTIONS}
        value={answers.q3}
        onPick={pickAndAdvance('q3', 'q4')}
      />
    );
    stepIndex = 3;
  } else if (step === 'q4') {
    body = (
      <ChoiceStep
        key="q4"
        eyebrow="your relationship to it"
        prompt="How are you in relation to this situation?"
        options={Q4_OPTIONS}
        value={answers.q4}
        onPick={pickAndAdvance('q4', 'q5')}
      />
    );
    stepIndex = 4;
  } else if (step === 'q5') {
    body = (
      <ChoiceStep
        key="q5"
        eyebrow="where you are right now"
        prompt="Which of these feels truest?"
        options={Q5_OPTIONS}
        value={answers.q5}
        onPick={pickAndAdvance('q5', 'q5')}
      />
    );
    stepIndex = 5;
  } else if (step === 'generating') {
    body = <Generating key="g" />;
    stepIndex = 6;
  } else if (step === 'prayer') {
    body = (
      <PrayerCard
        key="p"
        prayer={prayer?.prayer || ''}
        onSubmitEmail={submitEmail}
        onReplay={replay}
        submitted={submitted}
        sending={sending}
      />
    );
    stepIndex = STEPS.length - 1;
  }

  return (
    <section className="tlw-section">
      <section className="tlw-practice-section">
        <div className="tlw-inner">
          <Orb shimmer={step === 'generating'} rippleKey={rippleKey} />
          {body}
          {step !== 'prayer' && step !== 'intro' ? (
            <ProgressDots index={stepIndex - 1} total={5} />
          ) : null}
        </div>
      </section>
    </section>
  );
}
