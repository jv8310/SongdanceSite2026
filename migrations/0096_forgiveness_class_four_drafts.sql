-- Class 4 of the Forgiveness Course is no longer "Forgiving separation": it is
-- "Living with forgiveness", tying the three classes together (Jacob, November
-- 2026). The page, the session list and the app follow src/lib/courses/forgiveness.ts
-- and FCClasses.astro; the two broadcast drafts seeded by 0093 and 0095 carry
-- the old line in their schedule table, so it is changed there too.
--
-- Drafts only: a broadcast that is sending, paused or done keeps what it sent.
-- REPLACE() changes nothing when the text is not there (a draft already edited
-- in the admin), so this is safe to run again.

UPDATE broadcasts
SET body = REPLACE(REPLACE(REPLACE(body,
      '>Forgiving separation</p>', '>Living with forgiveness</p>'),
      '>and what lies underneath both</p>', '>tying it all together</p>'),
      '>and what&rsquo;s underneath</p>', '>tying it all together</p>'),
    body_text = REPLACE(REPLACE(body_text,
      'Forgiving separation, and what lies underneath both', 'Living with forgiveness, tying it all together'),
      'Forgiving separation, and what''s underneath', 'Living with forgiveness, tying it all together')
    , updated_at = datetime('now')
WHERE status = 'draft'
  AND name IN (
    'The Forgiveness Course — registrations open (December 2026)',
    'The Forgiveness Course — forgiveness is a paradox (November 2026)'
  );
