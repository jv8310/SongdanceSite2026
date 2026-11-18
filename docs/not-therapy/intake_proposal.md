# Intake before a course or retreat opens: proposal

*18 November 2026. Proposal only; nothing here is built. Companion to `not_therapy_audit.md` and
`safety_page_draft.md` in this folder.*

## In short

- Build **one intake record per person**, not one form per retreat. A course asks the short
  version, a retreat adds its own part, and a returning guest reviews what they said last time
  instead of starting again.
- Keep it on **songdance.co**, where the retreat intake, the Claude assessment and the admin pages
  already are. The app opens the form and only remembers whether the course may open. Health
  answers never enter an app table, a Claude connector, Drip or an email.
- A course opens **straight away** for most people, on their own ticks. Nobody starting a course
  waits for a call from you. A red flag reaches you as an email, and you decide whether to call.
  Claude's reading runs behind every intake and can **alert** you; it never closes a door by itself.
- Three things need your decision before anything is built: how strict the gate is (section 4), what
  a "no" costs the buyer (section 5), and what happens with the people already inside (section 8).
- A legal adviser should read this before launch. Section 10 lists what to ask.

## 1. What exists today

The retreat intake at `/intake` already does much of what you describe:

| Already there | Where |
| --- | --- |
| About 30 questions in Dutch and English, one per screen: sleep, energy, medication, trauma history, dissociation, diagnoses, suicidality, support network | `src/lib/intake/steps.ts`, `copy.ts` |
| Phone number, required | same |
| Three required ticks at the end, the first being "this retreat is not a substitute for individual (trauma) therapy" | same |
| Claude reads every intake and files it as Safe / Needs a call / Further investigation / Red flag, with what to ask in a call | `system-prompt.ts`, `assess.ts` |
| An email to jacob@songdance.co for every intake, classification in the subject | `src/pages/api/intake/submit.ts` |
| Admin list filtered by classification, invitations and reminders from the retreat's page | `/admin/intakes`, `/admin/retreats/<slug>` |
| Privacy policy sections on intake data and on Claude's part in it | `privacy.astro` 3.5 and 3.6 |
| Terms article 19: "educational and experiential in nature and do not replace medical or psychological treatment" | `terms.astro` |

What it does not do:

1. **It is tied to one retreat, not to a person.** Each submission is a loose row under a retreat
   code. A guest who comes to a second retreat answers everything again, and nothing shows you
   their earlier intake beside the new one.
2. **Nobody can revise.** A new submission is a new row; the old one is not replaced or compared.
3. **A red flag can go unseen.** The assessment runs in the background after the guest presses
   send. When that background step is cut short (the code's own comment says this happens
   often), an hourly catch-up finishes the assessment but **sends no email**. So an intake can be
   filed as a red flag with nothing reaching your inbox. The guest's own confirmation email is
   lost the same way.
4. **The email to you carries every answer**: diagnoses, medication, suicidality, in full, in your
   mailbox and in the mail provider's logs.
5. **It gates nothing.** The intake is sent by hand after payment and its outcome changes nothing
   in the booking. A course has no intake and no acknowledgment at all.
6. **The privacy policy promises three things the site does not yet do.** It says intake answers
   are "read only by the facilitators of that program" (every admin login can open them), that
   they are "deleted within twelve months after the program ends" (nothing deletes them; there is
   only a delete button per intake), and that someone who would rather not have their intake read
   with Claude's help can "say so in the form" (the form has no such field). The consent box on
   the form does not mention health data or Claude either.
7. **Only one retreat screens before payment.** Ritual of Belonging has a section ("A circle worth
   protecting") and a required box confirming none of its situations apply. Dolphin & Sound has no
   statement, no screening and no such box, and its booking is non-refundable; the Dutch
   Klankopstellingen page has none either.
8. Small: the assessor still asks for an older Claude model by name; the travel-questions tool
   beside it is on the current one. Worth bringing in line when this is touched.

Points 3, 4 and 6 affect the retreats today, whatever you decide about courses.

## 2. The shape I recommend

### Three levels

| Level | What the person does | For |
| --- | --- | --- |
| **0. Acknowledgment** | One unticked box at checkout: education, not therapy. Stored with the order. | Everything sold, workshops and masterclasses included |
| **1. Course intake** | About three minutes, after buying, before the course opens | 12-week course, certification course and the path, the German 12-week course, Grief, Forgiveness, Inner Child |
| **2. Retreat intake** | The course intake plus the retreat part (today's longer form) and the travel questions; a short call with you for everyone | Every retreat |

You wrote "all courses and retreats". My suggestion is to leave the lighter products at level 0:
the Authentic Singing Journey and its Dutch edition, the Magical Movement Journey, the mantra
collections, Gift of Empathy, Song of Your Soul Vow, the albums, and the live pass (its holders
already did the course intake). And to keep the €22 workshop and the €44 masterclass at level 0
too: people book them hours before they start, from an ad, and a gate there would cost most of the
registrations without anyone having time to read the answers. The acknowledgment box and a clear
line on the page do the work there. Your call (decision 1).

### One record per person

In plain words, four things are kept, all on the site:

- **The person**: address, name, phone, the language they answered in.
- **Their answers, by version**: every time they save, a new version is kept beside the old one,
  so you can see what changed.
- **Claude's reading** of a version, and your own note and decision.
- **What each course or retreat needs from them and where it stands**: not needed / waiting /
  open / waiting for their tick / red flag to read / not now.

The existing retreat submissions are brought in as first versions, so nothing is lost and the
people who filled one in for Dolphin & Sound or Ritual of Belonging are not asked again from zero.

### Revising

- A member can open **"My intake"** at any time and change an answer. A change is read again by
  Claude; you are only written to when the reading gets heavier.
- A course intake counts for **12 months**. Buying another course inside that time asks one screen:
  "Is this still true?" with their answers shown, and the acknowledgment for the new course.
- A retreat always asks for a **review in the 60 days before it starts**, however recent the
  intake, because the retreat part asks about now: sleep, energy, what happened lately.

## 3. The course intake, question by question (draft)

Short on purpose, and mostly ticks rather than stories, so that we hold as little as possible.

1. **Your phone number**, with country code. Required. *"So Jacob can call you if something in
   your answers asks for a conversation. We don't use it for anything else."*
2. **What brings you to this course, and what do you hope to learn?** One text field.
3. **Is any of this part of your life at the moment?** Tick what applies.
   - I am in therapy, or in the care of a psychologist or psychiatrist
   - I take medication for my mental health
   - I have a diagnosis such as complex PTSD, a dissociative disorder, bipolar disorder,
     psychosis or borderline personality disorder
   - I sometimes dissociate: losing time, or feeling far from my body or my surroundings
   - Something major happened in the last three months: a loss, a separation, an illness, an accident
   - I have thoughts of ending my life, now or in recent months
   - None of these

   Beside this question, as in the retreat intake: *"If reading this stirs something and you want
   to talk to someone now…"* with the crisis lines for their country.
4. Only when something is ticked in 3: **Have you talked with your therapist or doctor about
   taking this course?** Yes / Not yet, I will before I start / I have no therapist or doctor at
   the moment.
5. **If personal material comes up, who can you turn to?** Someone close / A professional / Both /
   Not really.
6. **Anything you'd like the facilitators to know?** Optional.
7. **Before you begin**: required boxes, none ticked in advance.
   - *I understand that this course is education, not therapy, and not a substitute for therapy or
     medical care.*
   - *I am responsible for my own process and wellbeing during the course, and for having
     professional support in place if I need it.*
   - Only when something was ticked in 3 and the answer to 4 was Yes: *I have discussed taking
     this course with my therapist or doctor.*
   - *I agree that Jacob and the course's facilitators read these answers, with the help of an AI
     tool, to decide with me whether this is the right moment. I can see, change or delete them at
     any time.* With links to the safety page, the terms and the privacy policy.

Left out on purpose: which diagnosis, which medication, treatment history, sleep, substances.
The retreat part asks those, where you meet the person in a room for days. For a course they are
more than you need, and the law asks you to collect no more than you need (section 10).

## 4. What happens after they press send (decision 2)

*Revised on 18 November after Jacob's answer: no calls for people starting the 12-week course,
except perhaps on a red flag.*

For a course, nobody waits for a call. The member's own ticks open the course.

| The member sees | When | For you |
| --- | --- | --- |
| **"You're in."** The course opens at once. | Nothing ticked in question 3; or something ticked and they tick that they have discussed the course with their therapist or doctor | Nothing, unless Claude raises it |
| **"One thing first."** The course waits until they come back and tick it. | Something ticked in question 3, and they have not yet discussed it, or have no therapist or doctor | Nothing. No call. The screen asks them to talk it through with their therapist or doctor first, says their place is kept, and that they can have their money back if they would rather not start. |
| **A red flag** | They tick thoughts of ending their life; or Claude's reading of the whole intake comes back as a red flag | An email at once (section 6). You decide whether to call or write. |

**Claude's reading** runs behind every intake, as for the retreats. It can alert you; it never
closes a course by itself. That keeps the promise the privacy policy already makes ("decisions
about participation are always made by a person, never by the system"), and it is what
data-protection law expects of a decision this weighty.

What is left to decide:

- **Does a red flag hold the course?** Recommended: the tick "thoughts of ending my life" holds it
  until you have looked, because that is the person's own statement and the one case where
  starting alone with a recording is the wrong next step. A red flag that comes only from Claude's
  reading does not hold anything; it reaches you as an email and you decide.
- **Someone with a diagnosis and no therapist or doctor** cannot truthfully tick "I have
  discussed this". With no calls, the honest outcome is that they do not start until they have
  someone to discuss it with, and get their money back if they ask. If you would rather let them
  in on a different tick ("I have no professional support at the moment and I take this course on
  my own responsibility"), say so; I would not recommend it for the diagnoses named in question 3.
- **The same for every course?** You spoke of the 12-week course. I have assumed the same for
  the certification course, Grief, Forgiveness and Inner Child, and that calls stay with the
  retreats.

## 5. What a "not now" costs the buyer (decision 3)

The gate comes **after** payment, so the refund has to be said before they pay.

- **Courses.** The terms already give 30 days money back, no reason needed, on the 12-week,
  certification, Grief and journey courses (article 8.4.2). A "not now" from you can simply be a
  full refund under that. The Forgiveness Course is not named there (it is live and dated, and the
  article excludes live dated events), so its rule needs saying.
- **Retreats.** The terms say a deposit is non-refundable and a full payment 50% refundable up to
  eight weeks before. That cannot stand beside "your place is confirmed after the intake": if *you*
  decide it is not the moment, the guest must get everything back. This needs a sentence in the
  terms and on the booking form, and your decision on the case where the guest never fills the
  intake in.
- **Until the intake is done**, the 30 days should not be running against someone who has not been
  let in. Simplest: the guarantee counts from the day the course opens.

Proposed line under the pay button: *"After you pay, a few questions before the course opens. If
we both feel this isn't the moment, you get your money back."*

## 6. The email to you

- **When**: a red flag, for a course or a retreat: the member's own tick, or Claude's reading.
  A course that merely waits for the member's "I have discussed this" tick sends you nothing. Sent from wherever the assessment finishes, so the hourly catch-up sends it
  too, and exactly once.
- **To**: jacob@songdance.co. Say if Karen Evans or anyone else should get a copy for their courses.
- **What it says**: who, their phone number and address, which course or retreat, what raised it
  (their answer, or Claude's class), and a button to the intake on the admin page.
- **What it leaves out**: the answers and Claude's text. Today's retreat email carries all of it.
  I recommend moving both to "name, phone, reason, link": a mailbox is the place health data
  leaks from. If you prefer reading the full intake in your inbox, that can stay; it is your
  decision and belongs in the privacy policy either way (decision 4).
- **A morning line in the daily report** while a red flag is still unread after two working days,
  so it never sits forgotten.

Who reads the red flags besides you, for the weeks you are on retreat (decision 5)?

## 7. Where it sits in the app

- After buying, the course shows in the Library with **"One step before you begin"** instead of its
  first class. The button opens the intake, filled in with their name and address, the way
  "Submit for certification" opens the certification form today.
- Until it is done, that course's classes, files, course space and live sessions stay closed. The
  general CiRCLE, their other courses and anything free stay as they are.
- The site tells the app one word per course: waiting / open / held for a red flag. The app keeps
  nothing else. This is the certification form's arrangement, reused.
- The acknowledgment is repeated once in the course's welcome steps, as the brief asks.

Why the form is the site's and not a screen built into the app:

- One intake for course buyers and for retreat guests, who often have no app account.
- The questions, the Dutch and English copy, the assessor and the admin pages exist there.
- Everything in an `app_` table can be read through the Claude connector you use for the app
  (`query_app_table`); site tables cannot, by design. Health answers belong on the far side of
  that wall.
- A form inside the phone apps would make the apps themselves collectors of health data, which
  changes what must be declared to Apple and Google.

Cost: the form opens in a browser sheet rather than as a native screen. The certification form
already works this way.

Two build notes for later: phones that have not updated yet will not know the new "one step first"
state and need a sensible fallback (never "buy this course"); and the German course and the
five app languages need the intake in German, French and Spanish, or an honest fallback to English.

## 8. The people already inside (decision 6)

Today the app counts 1,019 seats in the 12-week space, 486 in the certification space and 158 in
the deepening sessions. Locking them out until they fill in a form would be a hard landing and a
support wave.

Recommended:

1. **Nobody who is in loses access.**
2. **Everyone acknowledges once**: the first-visit screen that already asks two ticks (age, community
   guidelines) asks a third at next sign-in: education, not therapy.
3. **Students with live sessions still running are invited** to the course intake, by a welcome
   step and one email, not forced.
4. **The intake is required from the next thing they buy**: another course, a retreat, a live pass
   when they have no intake on record.

Stricter option: from a date you name, a live session (Q&A, deepening session) only opens for
members with an intake on record. That reaches the people the group container is most exposed to,
without closing recorded material.

## 9. Retreats

Yes, more elaborate than a course, and it mostly is already. The change is to split today's form in two:

- **The shared core** = the course intake above. A guest who took a course has done it and reviews it.
- **The retreat part**: sleep, energy, substances, experience with experiential work and how it
  went, how they regulate themselves, which diagnosis and which medication, physical notes, and
  the travel questions. Plus the existing third tick: you and the team may postpone or refer.

And to make it a real gate:

- **The invitation goes out by itself** when the booking is paid, not by hand weeks later.
- **The booking says where it stands** on the retreat's admin page: awaiting intake / conversation /
  confirmed / not now.
- **The booking form says so**: *"Your place is confirmed after a short intake and a call with Jacob."*
  Ritual of Belonging's section and box are the model; Dolphin & Sound and every later retreat
  should carry the same before the pay button.
- **A call for everyone** stays, as now; Claude's class decides how long a call it needs.

## 10. Privacy and law: for the legal adviser

Intake answers are health data, a special category under GDPR article 9. What the design does
about it, and what to have checked:

| Point | In this proposal |
| --- | --- |
| **Explicit consent** | Its own tick on the intake, apart from the purchase and from the terms. Refusing it means a conversation with you instead of the form, not a silent refusal. |
| **Only what is needed** | The course intake asks categories, not diagnoses or medication names. Free text is limited to two fields. |
| **Who can read** | You, and named facilitators per course or retreat (decision 5). Admin logins that only need orders should not see intakes: today every admin login can. |
| **How long** | The privacy policy already says 12 months after the program ends. Proposed: keep that, and make it real with a nightly deletion: course answers 12 months after the course's live sessions end; retreat answers 12 months after the retreat; a "not now" 12 months after the decision; longer only when the person asks, as the policy allows. What stays: the acknowledgment (text version, date) with the order, as part of the contract. Your call (decision 7). |
| **Kept out of** | App tables and the Claude connector; Drip and broadcast tags (never a tag that says someone was flagged); analytics and the Meta pixel on the intake pages; email bodies (decision 4). |
| **Claude** | Anthropic processes the answers to prepare the reading; the privacy policy says so already (3.6) and says a person can ask for their intake not to be read this way. That needs a real choice on the form, not "say so in the form". |
| **No automatic decisions** | A rule may make a course *wait for a person*; only you decide "not now". |
| **Their rights** | See, change, delete from "My intake"; deletion closes the course if the intake was required for it. |
| **Children** | The app already asks for 18+. The intake should too. |

Questions for the adviser:

1. Is a data protection impact assessment required here? Health data, read with the help of AI,
   deciding access to something paid for: I expect yes.
2. Does screening for diagnoses and medication, together with wording such as "therapeutic
   framework", create a duty of care or touch the Belgian rules on mental-health professions? The
   "education, not therapy" line carries legal weight as well as practical weight, and an intake
   that looks clinical pulls the other way (section 11).
3. The refund wording in section 5, and whether the acknowledgment box and terms article 19 are
   worded so they hold for consumers in the EU, the UK and the US.
4. Whether a phone number may be required, given its only purpose is a call about the intake.
5. The privacy policy needs updating before launch: 3.5 speaks of "retreats and some in-depth
   programs"; it should name the courses, the phone number's purpose and the member's "My intake"
   page. Private sessions (the booking note, the recording) and certification videos are not
   covered by it at all today.
6. The terms have no right to decline, postpone or refer someone on wellbeing grounds (article 18
   covers conduct only), although the intake asks people to agree to exactly that. They also say
   (article 14.2) that consent to immediate access "is requested at checkout", and no checkout
   has that box. With an intake gate, access is no longer immediate, so that article needs a look
   in any case.

## 11. Four things to weigh before building

**An intake can make this look more like therapy, not less.** Asking a buyer about diagnoses,
medication and dissociation is what a clinic does. Done carelessly it tells people the opposite
of the checkbox two screens later. That is why the course intake is short, asks about support
rather than symptoms, and is framed as *"is this the right moment, and do you have what you need
around you"*. It is also why the retreat questions stay with the retreats.

**Once you ask, you have to answer.** A tick beside "thoughts of ending my life" at two in the
night creates an expectation that someone reads it. The form has to say plainly that nobody reads
it in real time, give the crisis lines on that screen, and you need a working rhythm for the
emails, including the weeks you are away. An intake nobody reads is a greater risk than no intake.

**"Trauma-informed" and "the method keeps you regulated" are claims.** The copy book forbids
safety guarantees, and chapter 31 says it best: *"seldom is not never."* The safety page draft
says what the practice does (your volume, the witness's seat, one pace back, no pushing) and
what you do (pace, choice, the intake, saying "not now"), and stops short of promising an effect.
Each line there needs your confirmation that it is true of every facilitator.

**Your own words pull two ways.** The copy book defines Somatic Vocal Healing as somatic sounding
with a therapeutic framework on top; the certification course has a class called "Therapeutic
Foundations" and its last class says "Healing, not therapy". The brief says "education, not
therapy" and "space holders, not healers". Those can live together: the *course* is education; what
a certified practitioner *offers* is space holding with a framework; healing is the participant's
own. But the public pages should use one pair of words for each, and the audit lists where they
currently mix.

## 12. Order of work, if you say yes

1. **Now, small**: the red-flag email from the hourly catch-up, the email without the answers,
   and the three privacy-policy promises (section 1, points 3, 4 and 6). Independent of
   everything else.
2. **Copy** (the audit's rewrites), the safety page, the terms clause, "Is this therapy?" in each FAQ.
3. **Acknowledgment box** at every checkout, stored per order with the wording's version; the same
   line in the confirmation email and a welcome step; the third tick for existing members.
4. **The intake record** on the site: person, versions, readings, decisions; "My intake"; the
   existing submissions brought in.
5. **Course intake and the gate**: app deployed first (it learns the new state), then the site.
6. **Retreats on the same record**: automatic invitation, status on the booking, review before
   each retreat.

Steps 1 to 3 do not depend on the adviser. Steps 4 to 6 should wait for them.

The Forgiveness Course starts on 6 December. Step 3 can be in place for it; a gate (step 5)
realistically cannot, and its buyers so far bought without one.

## Decisions for Jacob

1. **Which products get the course intake.** Recommended: 12-week, certification and path, German
   12-week, Grief, Forgiveness, Inner Child. Workshops, masterclass, journeys, albums and the live
   pass: acknowledgment only.
2. **The gate** (section 4, revised): whether a red flag holds the course, what happens to
   someone with a diagnosis and no therapist or doctor, and whether the certification course,
   Grief, Forgiveness and Inner Child follow the 12-week course in having no calls.
3. **Refunds on "not now"**, for courses and for retreats, and when the 30 days start.
4. **The email**: name, phone, reason and link only (recommended), or the full intake as today.
5. **Who reads and who may open a course** besides you: Karen Evans, Daniela Hess, Lorenz and
   Carmen for the German course, the retreat co-facilitators?
6. **Existing members**: acknowledgment for all and an invitation (recommended), or intake
   required for live sessions from a date.
7. **How long answers are kept.**
8. **Red flags while you are away**: who reads them, and within how many working days.
9. **Private sessions**: whether the "one thing first" screen and the course pages may point
   to `/sessions` for people whose main need is personal support.
