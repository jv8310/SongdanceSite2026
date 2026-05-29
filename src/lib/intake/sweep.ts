// Catch-up pass for intake submissions that never got a classification.
//
// The /api/intake/submit endpoint schedules its Claude assessment in
// ctx.waitUntil so the deelnemer gets an instant "Aangekomen". On
// Cloudflare that background task is frequently torn down before the
// 30–90s Claude call (and the follow-up D1 UPDATE) finish, leaving rows
// stuck at classification = NULL ("No assessment").
//
// This runs the same assessment synchronously, one row at a time, for
// every still-unassessed submission. It's invoked from the hourly Cron
// trigger (see the worker entrypoint) and mirrors what the admin
// "Assess pending" button does by hand. Emails are intentionally left
// out — like the manual reassess, this only fills in the assessment so
// the admin views are correct.

import { resolveEventWithDb } from './events';
import { buildAssessorUserMessage, runAssessment } from './assess';
import type { Locale } from './copy';

interface PendingRow {
  id: string;
  event_code: string;
  locale: string;
  payload_json: string;
}

export interface SweepResult {
  found: number;
  assessed: number;
  failed: number;
  skipped: number;
}

export async function assessPendingSubmissions(args: {
  db: D1Database | undefined;
  apiKey: string | undefined;
  // Cap per run so a backlog drains gradually instead of risking the
  // worker's execution budget. At ~30–90s per Claude call this stays
  // comfortably inside the scheduled-worker wall-clock limit.
  limit?: number;
  // Stop starting new assessments once this much wall-clock has elapsed.
  budgetMs?: number;
}): Promise<SweepResult> {
  const { db, apiKey } = args;
  const limit = args.limit ?? 8;
  const budgetMs = args.budgetMs ?? 12 * 60 * 1000;
  const startedAt = Date.now();
  const result: SweepResult = { found: 0, assessed: 0, failed: 0, skipped: 0 };

  if (!db) return result;

  const rows =
    (
      await db
        .prepare(
          `SELECT id, event_code, locale, payload_json
             FROM intake_submissions
            WHERE classification IS NULL
            ORDER BY created_at ASC
            LIMIT ?`,
        )
        .bind(limit)
        .all<PendingRow>()
    ).results ?? [];

  result.found = rows.length;

  for (const row of rows) {
    if (Date.now() - startedAt > budgetMs) {
      result.skipped++;
      continue;
    }

    let answers: Record<string, unknown> = {};
    try {
      answers = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      answers = {};
    }

    const locale: Locale = row.locale === 'en' ? 'en' : 'nl';
    const event = await resolveEventWithDb(db, row.event_code);
    const userMessage = buildAssessorUserMessage({ event, locale, answers });

    const assessment = await runAssessment({ apiKey, userMessage });

    try {
      await db
        .prepare(
          `UPDATE intake_submissions
              SET assessment_md = ?, classification = ?, assessment_error = ?
            WHERE id = ?`,
        )
        .bind(
          assessment.markdown || null,
          assessment.classification,
          assessment.error,
          row.id,
        )
        .run();
    } catch (err) {
      console.error('[intake/sweep] D1 update failed', err);
    }

    if (assessment.error) result.failed++;
    else result.assessed++;
  }

  return result;
}
