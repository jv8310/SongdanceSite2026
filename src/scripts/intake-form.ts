// Client-side state machine for /intake.
//
// The page server-renders a config blob into a <script id="intake-config"
// type="application/json"> tag with the resolved locale, event, step list,
// copy and shared strings. This script reads it, mounts the form UI, and
// drives one-question-per-screen progress until the deelnemer submits.

import type { Locale, StepCopy, SharedCopy } from '../lib/intake/copy';
import type { StepDef } from '../lib/intake/steps';

type Answers = Record<string, string | string[] | Record<string, boolean>>;

interface Config {
  locale: Locale;
  eventCode: string;
  eventLabel: string;
  shared: SharedCopy;
  steps: StepDef[];
  copy: Record<string, StepCopy>;
  apiUrl: string;
  homeUrl: string;
  langSwitchUrl: string;
}

type Phase = 'form' | 'submitting' | 'done' | 'error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function readConfig(): Config {
  const node = document.getElementById('intake-config');
  if (!node) throw new Error('intake-config missing');
  const cfg = JSON.parse(node.textContent || '{}') as Partial<Config>;
  if (!cfg.steps || !cfg.copy || !cfg.shared) {
    throw new Error('intake-config malformed');
  }
  // re-attach the function for progressOf (lost across JSON)
  const sharedRaw = cfg.shared as unknown as SharedCopy & { progressOf?: unknown };
  const localized = (cfg.locale === 'en') ? 'of' : 'van';
  sharedRaw.progressOf = (a: number, b: number) => `${a} ${localized} ${b}`;
  return cfg as Config;
}

function isStepVisible(step: StepDef, answers: Answers): boolean {
  if (!step.showIf) return true;
  const dep = answers[step.showIf.stepKey];
  if (typeof dep !== 'string') return false;
  return step.showIf.valueIn.includes(dep);
}

function isAnswered(step: StepDef, answers: Answers): boolean {
  const v = answers[step.key];
  switch (step.type) {
    case 'text':
    case 'email':
    case 'number':
    case 'textarea':
    case 'radio':
      return typeof v === 'string' && v.trim().length > 0;
    case 'checkboxes':
      return Array.isArray(v) && v.length > 0;
    case 'consent': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const map = v as Record<string, boolean>;
      return (step.consentKeys ?? []).every((k) => map[k] === true);
    }
    case 'intro':
    case 'pause':
      return true;
  }
}

function validateStep(
  step: StepDef,
  answers: Answers,
  shared: SharedCopy,
): string | null {
  const v = answers[step.key];

  if (step.type === 'email') {
    if (!step.required && (typeof v !== 'string' || v.trim() === '')) return null;
    if (typeof v !== 'string' || !EMAIL_RE.test(v.trim())) return shared.emailInvalid;
    return null;
  }
  if (step.type === 'number') {
    if (!step.required && (typeof v !== 'string' || v.trim() === '')) return null;
    if (typeof v !== 'string' || !/^\d+$/.test(v.trim())) return shared.numberInvalid;
    return null;
  }
  if (step.required) {
    if (!isAnswered(step, answers)) {
      if (step.type === 'consent') return shared.consentRequired;
      if (step.type === 'radio') return shared.selectOne;
      return shared.required;
    }
  }
  return null;
}

class IntakeApp {
  private cfg: Config;
  private root: HTMLElement;
  private progressEl: HTMLElement;
  private progressLabel: HTMLElement;
  private answers: Answers = {};
  private idx = 0;
  private phase: Phase = 'form';
  private errorMessage = '';
  private validationMessage = '';

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.root = $('intake-step-root');
    this.progressEl = $('intake-progress-fill');
    this.progressLabel = $('intake-progress-label');
  }

  start() {
    this.render();
  }

  private visibleSteps(): StepDef[] {
    return this.cfg.steps.filter((s) => isStepVisible(s, this.answers));
  }

  // Counted progress: total = visible non-intro/non-pause/non-closing steps;
  // current = how many of those are at or behind the cursor.
  private progressNumbers(): { current: number; total: number } {
    const visible = this.visibleSteps();
    const isCounted = (s: StepDef) =>
      s.type !== 'intro' && s.type !== 'pause';
    const total = visible.filter(isCounted).length;
    let current = 0;
    for (let i = 0; i <= this.idx && i < visible.length; i++) {
      if (isCounted(visible[i]!)) current++;
    }
    return { current: Math.min(current, total), total };
  }

  private currentStep(): StepDef | null {
    const visible = this.visibleSteps();
    return visible[this.idx] ?? null;
  }

  private goNext() {
    const step = this.currentStep();
    if (!step) return;
    if (this.phase === 'form') {
      const err = validateStep(step, this.answers, this.cfg.shared);
      if (err) {
        this.validationMessage = err;
        this.render();
        return;
      }
    }
    this.validationMessage = '';
    const visible = this.visibleSteps();
    if (this.idx + 1 >= visible.length) {
      this.submit();
      return;
    }
    this.idx++;
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private goBack() {
    if (this.idx === 0) return;
    this.idx--;
    this.validationMessage = '';
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private async submit() {
    this.phase = 'submitting';
    this.render();
    try {
      const res = await fetch(this.cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventCode: this.cfg.eventCode,
          locale: this.cfg.locale,
          answers: this.answers,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'upstream');
      }
      this.phase = 'done';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.phase = 'error';
    }
    this.render();
  }

  // ---------- Rendering ----------

  private render() {
    if (this.phase === 'submitting') {
      this.renderSubmitting();
      return;
    }
    if (this.phase === 'done') {
      this.renderDone();
      return;
    }
    if (this.phase === 'error') {
      this.renderError();
      return;
    }
    this.renderStep();
  }

  private renderSubmitting() {
    const s = this.cfg.shared;
    this.root.innerHTML = `
      <div class="in-submitting">
        <div class="in-spinner" aria-hidden="true"></div>
        <h1>${escapeHtml(s.submittingTitle)}</h1>
        <p class="in-body">${escapeHtml(s.submittingBody)}</p>
      </div>
    `;
    this.renderFooter(true, '', '');
    this.updateProgress();
  }

  private renderDone() {
    const c = this.cfg.copy.done ?? {};
    this.root.innerHTML = `
      <div class="in-done">
        <h1>${escapeHtml(c.title ?? '')}</h1>
        <p class="in-body">${escapeHtml(c.body ?? '')}</p>
      </div>
    `;
    this.renderFooter(true, '', '');
    this.progressEl.style.width = '100%';
    this.progressLabel.textContent = '';
  }

  private renderError() {
    const s = this.cfg.shared;
    this.root.innerHTML = `
      <div class="in-failure">
        <h1>${escapeHtml(s.errorTitle)}</h1>
        <p class="in-body">${escapeHtml(s.errorBody)}</p>
        <button type="button" class="in-btn in-btn-primary" id="intake-retry">${escapeHtml(s.errorRetry)}</button>
      </div>
    `;
    this.renderFooter(true, '', '');
    document.getElementById('intake-retry')?.addEventListener('click', () => {
      this.phase = 'form';
      this.submit();
    });
  }

  private renderStep() {
    const step = this.currentStep();
    if (!step) return;
    const copy = this.cfg.copy[step.key] ?? {};
    const isLast = this.idx === this.visibleSteps().length - 1;
    const s = this.cfg.shared;

    let html = '';
    const isPause = step.type === 'pause';
    html += `<div class="in-step ${isPause ? 'in-step-pause' : ''}">`;
    if (copy.title) {
      html += `<h1>${escapeHtml(copy.title)}</h1>`;
    }
    if (copy.body) {
      html += `<p class="in-body">${escapeHtml(copy.body)}</p>`;
    }
    html += this.renderInput(step, copy);
    if (copy.microNote) {
      html += `<p class="in-micro">${escapeHtml(copy.microNote)}</p>`;
    }
    if (this.validationMessage) {
      html += `<p class="in-error" role="alert">${escapeHtml(this.validationMessage)}</p>`;
    }
    html += `</div>`;
    this.root.innerHTML = html;

    this.wireInputs(step);

    const nextLabel = isLast ? s.submit : s.next;
    const showBack = this.idx > 0;
    this.renderFooter(true, nextLabel, showBack ? s.back : '');
    this.updateProgress();
  }

  private renderInput(step: StepDef, copy: StepCopy): string {
    switch (step.type) {
      case 'intro':
      case 'pause':
        return '';
      case 'text':
      case 'email':
        return `
          <div class="in-field">
            <input
              type="${step.type === 'email' ? 'email' : 'text'}"
              id="intake-input"
              autocomplete="${step.type === 'email' ? 'email' : 'off'}"
              maxlength="${step.maxLength ?? 250}"
              placeholder="${escapeAttr(copy.placeholder ?? '')}"
              value="${escapeAttr(asString(this.answers[step.key]))}"
            />
          </div>
        `;
      case 'number':
        return `
          <div class="in-field">
            <div class="in-field-row">
              <input
                type="number"
                inputmode="numeric"
                id="intake-input"
                min="0"
                max="120"
                placeholder=""
                value="${escapeAttr(asString(this.answers[step.key]))}"
              />
              ${copy.hint ? `<span class="in-field-hint">${escapeHtml(copy.hint)}</span>` : ''}
            </div>
          </div>
        `;
      case 'textarea':
        return `
          <div class="in-field">
            <textarea
              id="intake-input"
              maxlength="${step.maxLength ?? 2000}"
              placeholder="${escapeAttr(copy.placeholder ?? '')}"
              rows="6"
            >${escapeHtml(asString(this.answers[step.key]))}</textarea>
          </div>
        `;
      case 'radio': {
        const current = asString(this.answers[step.key]);
        const opts = (step.options ?? [])
          .map((o) => {
            const label = copy.options?.[o.value] ?? o.value;
            const checked = current === o.value ? 'checked' : '';
            return `
              <li>
                <label class="in-option">
                  <input type="radio" name="${escapeAttr(step.key)}" value="${escapeAttr(o.value)}" ${checked} />
                  <span class="in-option-text">${escapeHtml(label)}</span>
                </label>
              </li>
            `;
          })
          .join('');
        return `<ul class="in-options">${opts}</ul>`;
      }
      case 'checkboxes': {
        const arr = Array.isArray(this.answers[step.key])
          ? (this.answers[step.key] as string[])
          : [];
        const opts = (step.options ?? [])
          .map((o) => {
            const label = copy.options?.[o.value] ?? o.value;
            const checked = arr.includes(o.value) ? 'checked' : '';
            return `
              <li>
                <label class="in-option">
                  <input type="checkbox" name="${escapeAttr(step.key)}" value="${escapeAttr(o.value)}" ${checked} />
                  <span class="in-option-text">${escapeHtml(label)}</span>
                </label>
              </li>
            `;
          })
          .join('');
        return `<ul class="in-options">${opts}</ul>`;
      }
      case 'consent': {
        const state = (this.answers[step.key] ?? {}) as Record<string, boolean>;
        const items = (step.consentKeys ?? [])
          .map((k) => {
            const text = copy.consents?.[k] ?? k;
            const checked = state[k] === true ? 'checked' : '';
            return `
              <label class="in-consent">
                <input type="checkbox" data-consent-key="${escapeAttr(k)}" ${checked} />
                <span>${escapeHtml(text)}</span>
              </label>
            `;
          })
          .join('');
        return `<div class="in-consents">${items}</div>`;
      }
    }
  }

  private wireInputs(step: StepDef) {
    const root = this.root;
    if (step.type === 'text' || step.type === 'email' || step.type === 'number' || step.type === 'textarea') {
      const inp = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('#intake-input');
      if (inp) {
        inp.addEventListener('input', () => {
          this.answers[step.key] = inp.value;
          this.validationMessage = '';
        });
        // Enter advances on single-line inputs (not textarea)
        if (step.type !== 'textarea') {
          inp.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Enter') {
              e.preventDefault();
              this.goNext();
            }
          });
        }
        // Auto-focus first input
        setTimeout(() => inp.focus(), 80);
      }
    } else if (step.type === 'radio') {
      root.querySelectorAll<HTMLInputElement>(`input[name="${cssEscape(step.key)}"]`).forEach((el) => {
        el.addEventListener('change', () => {
          this.answers[step.key] = el.value;
          this.validationMessage = '';
          // Auto-advance after a brief beat so the choice is visible.
          window.setTimeout(() => {
            if (this.phase === 'form' && this.currentStep()?.key === step.key) {
              this.goNext();
            }
          }, 320);
        });
      });
    } else if (step.type === 'checkboxes') {
      root.querySelectorAll<HTMLInputElement>(`input[name="${cssEscape(step.key)}"]`).forEach((el) => {
        el.addEventListener('change', () => {
          const arr = Array.isArray(this.answers[step.key])
            ? ([...(this.answers[step.key] as string[])])
            : [];
          if (el.checked) {
            if (!arr.includes(el.value)) arr.push(el.value);
          } else {
            const i = arr.indexOf(el.value);
            if (i >= 0) arr.splice(i, 1);
          }
          this.answers[step.key] = arr;
          this.validationMessage = '';
        });
      });
    } else if (step.type === 'consent') {
      root.querySelectorAll<HTMLInputElement>('input[data-consent-key]').forEach((el) => {
        el.addEventListener('change', () => {
          const map = (typeof this.answers[step.key] === 'object'
            && !Array.isArray(this.answers[step.key])
            && this.answers[step.key] !== null)
            ? { ...(this.answers[step.key] as Record<string, boolean>) }
            : {};
          const key = el.dataset.consentKey!;
          map[key] = el.checked;
          this.answers[step.key] = map;
          this.validationMessage = '';
        });
      });
    }
  }

  private renderFooter(_visible: boolean, nextLabel: string, backLabel: string) {
    const footer = $('intake-footer');
    footer.innerHTML = `
      <div class="in-footer-inner">
        <button type="button" class="in-btn in-btn-quiet" id="intake-back" ${backLabel ? '' : 'disabled'}>
          ${backLabel ? `<span aria-hidden="true">←</span> ${escapeHtml(backLabel)}` : ''}
        </button>
        <button type="button" class="in-btn in-btn-primary" id="intake-next" ${nextLabel ? '' : 'disabled style="visibility:hidden"'}>
          ${escapeHtml(nextLabel)} ${nextLabel ? '<span aria-hidden="true">→</span>' : ''}
        </button>
      </div>
    `;
    document.getElementById('intake-back')?.addEventListener('click', () => this.goBack());
    document.getElementById('intake-next')?.addEventListener('click', () => this.goNext());
  }

  private updateProgress() {
    const { current, total } = this.progressNumbers();
    const pct = total === 0 ? 0 : (current / total) * 100;
    this.progressEl.style.width = `${pct}%`;
    this.progressLabel.textContent =
      total > 0 && current > 0 ? this.cfg.shared.progressOf(current, total) : '';
  }
}

// ---------- helpers ----------
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function cssEscape(s: string): string {
  // attribute selector — letters/digits/underscores only in our keys
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ---------- bootstrap ----------
(() => {
  try {
    const cfg = readConfig();
    const app = new IntakeApp(cfg);
    app.start();
  } catch (err) {
    console.error('[intake] init failed', err);
  }
})();
