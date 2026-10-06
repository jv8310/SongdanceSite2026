// Small building blocks shared by the course confirmation and sequence emails —
// greeting, paragraphs, buttons, lists, the order panel and the "how to get
// in" block. Every email still renders in the shared parchment shell
// (../../workshops/emails.ts → shell), so a course email looks like every other
// Songdance email. Each block returns its HTML and its plain-text twin
// together, so the two parts of an email can never say different things.

import { escapeHtml, PALETTE } from '../../workshops/emails';
import { tidyFirstName } from '../../email/names';
import { CIRCLE_HOME_URL } from '../circle';

export type Block = { html: string; text: string };

const P = 'margin:0 0 14px;';

export function greeting(name?: string | null, lang: 'en' | 'nl' = 'en'): Block {
  const first = tidyFirstName(name);
  if (lang === 'nl') {
    return first
      ? { html: `<p style="${P}">Dag ${escapeHtml(first)},</p>`, text: `Dag ${first},` }
      : { html: `<p style="${P}">Dag,</p>`, text: 'Dag,' };
  }
  return first
    ? { html: `<p style="${P}">Dear ${escapeHtml(first)},</p>`, text: `Dear ${first},` }
    : { html: `<p style="${P}">Hello,</p>`, text: 'Hello,' };
}

// A paragraph. `[text](/path)` becomes a link (relative paths resolve against
// `base`); everything else is escaped.
export function para(s: string, base = 'https://songdance.co', opts?: { small?: boolean }): Block {
  const style = opts?.small ? 'margin:0 0 14px;font-size:14px;' : P;
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let html = '';
  let text = '';
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const before = s.slice(last, m.index);
    const href = absolute(m[2], base);
    html += `${escapeHtml(before)}<a href="${escapeHtml(href)}" style="color:${PALETTE.ember};">${escapeHtml(m[1])}</a>`;
    text += `${before}${m[1]} (${href})`;
    last = m.index + m[0].length;
  }
  html += escapeHtml(s.slice(last));
  text += s.slice(last);
  return { html: `<p style="${style}">${html}</p>`, text };
}

export function paras(lines: string[], base?: string): Block[] {
  return lines.map((l) => para(l, base));
}

export function eyebrow(s: string): Block {
  return {
    html: `<p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(s)}</p>`,
    text: s.toUpperCase(),
  };
}

export function subhead(s: string): Block {
  return {
    html: `<p style="margin:22px 0 8px;font-size:17px;color:${PALETTE.ink};">${escapeHtml(s)}</p>`,
    text: s,
  };
}

// "• lead — rest" lines. A lead (optional) is set in the ink colour.
export function list(items: Array<string | { lead: string; rest?: string }>): Block {
  const lis = items.map((it) => {
    const lead = typeof it === 'string' ? '' : it.lead;
    const rest = typeof it === 'string' ? it : it.rest ?? '';
    return {
      html: `<li style="margin:0 0 8px;">${lead ? `<span style="color:${PALETTE.ink};">${escapeHtml(lead)}</span>${rest ? ' ' : ''}` : ''}${escapeHtml(rest)}</li>`,
      text: `• ${lead}${lead && rest ? ' ' : ''}${rest}`,
    };
  });
  return {
    html: `<ul style="margin:0 0 16px;padding:0 0 0 20px;">${lis.map((l) => l.html).join('')}</ul>`,
    text: lis.map((l) => l.text).join('\n'),
  };
}

export function button(label: string, href: string): Block {
  return {
    html: `<div style="padding:8px 0 18px;"><a href="${escapeHtml(href)}" style="display:inline-block;background-color:${PALETTE.ink};color:${PALETTE.bg};font-family:Georgia,serif;font-size:15px;line-height:1;text-decoration:none;padding:14px 26px;border-radius:999px;">${escapeHtml(label)}</a></div>`,
    text: `${label}:\n${href}`,
  };
}

// The quiet, outlined button — "Stop these weekly emails". Deliberately easy to
// find and easy to press, but never louder than the session it sits under.
export function quietButton(label: string, href: string, note?: string): Block {
  return {
    html: `<div style="margin-top:26px;padding-top:18px;border-top:1px solid ${PALETTE.border};text-align:center;">
        <a href="${escapeHtml(href)}" style="display:inline-block;border:1px solid ${PALETTE.faint};color:${PALETTE.soft};font-family:Georgia,serif;font-size:13px;line-height:1;text-decoration:none;padding:10px 18px;border-radius:999px;">${escapeHtml(label)}</a>
        ${note ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:${PALETTE.faint};">${escapeHtml(note)}</p>` : ''}
      </div>`,
    text: `${label}:\n${href}${note ? `\n${note}` : ''}`,
  };
}

// The order, as a small boxed list: one line per item, then the payment line.
export function orderPanel(title: string, rows: Array<[string, string]>, footer?: string): Block {
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 0;font-size:14px;color:${PALETTE.soft};">${escapeHtml(k)}</td><td align="right" style="padding:3px 0 3px 12px;font-size:14px;color:${PALETTE.ink};white-space:nowrap;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  return {
    html: `<div style="margin:6px 0 20px;padding:14px 18px;border:1px solid ${PALETTE.border};border-radius:10px;background-color:${PALETTE.bg};">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(title)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>
        ${footer ? `<p style="margin:8px 0 0;font-size:13px;color:${PALETTE.soft};">${escapeHtml(footer)}</p>` : ''}
      </div>`,
    text: `${title.toUpperCase()}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${footer ? `\n${footer}` : ''}`,
  };
}

// How to get in. The CiRCLE reads the order, so there is nothing to activate —
// the one thing a buyer needs is to sign in with the address they bought with.
export function accessBlock(loginEmail: string, what: string): Block {
  const host = CIRCLE_HOME_URL.replace(/^https?:\/\//, '');
  return {
    html: `<p style="${P}">Everything is waiting for you in the Songdance CiRCLE, our course app. Sign in at <a href="${CIRCLE_HOME_URL}" style="color:${PALETTE.ember};">${host}</a> with <strong style="color:${PALETTE.ink};font-weight:normal;">${escapeHtml(loginEmail)}</strong> — ${escapeHtml(what)} is already on your account. There’s nothing to activate.</p>`,
    text: `Everything is waiting for you in the Songdance CiRCLE, our course app. Sign in at ${CIRCLE_HOME_URL} with ${loginEmail} — ${what} is already on your account. There’s nothing to activate.`,
  };
}

export function accessBlockNl(loginEmail: string, what: string): Block {
  const host = CIRCLE_HOME_URL.replace(/^https?:\/\//, '');
  return {
    html: `<p style="${P}">Alles staat klaar in de Songdance CiRCLE, onze cursus-app. Meld je aan op <a href="${CIRCLE_HOME_URL}" style="color:${PALETTE.ember};">${host}</a> met <strong style="color:${PALETTE.ink};font-weight:normal;">${escapeHtml(loginEmail)}</strong> — ${escapeHtml(what)} staat al op je account. Je hoeft niets te activeren.</p>`,
    text: `Alles staat klaar in de Songdance CiRCLE, onze cursus-app. Meld je aan op ${CIRCLE_HOME_URL} met ${loginEmail} — ${what} staat al op je account. Je hoeft niets te activeren.`,
  };
}

export function signoff(closing = 'With love,', name = 'Jacob'): Block {
  return {
    html: `<p style="margin:18px 0 0;">${escapeHtml(closing)}<br />${escapeHtml(name)}</p>`,
    text: `${closing}\n${name}`,
  };
}

export function join(blocks: Array<Block | null | undefined | false>): Block {
  const bs = blocks.filter(Boolean) as Block[];
  return {
    html: bs.map((b) => b.html).join('\n      '),
    text: bs.map((b) => b.text).join('\n\n'),
  };
}

function absolute(href: string, base: string): string {
  if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return href;
  return `${base.replace(/\/+$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;
}
