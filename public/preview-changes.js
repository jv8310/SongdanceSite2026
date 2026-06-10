/* Preview-only highlighter for the copy-book pass (June 2026).
 *
 * Off by default. Turn on by visiting any page with `?changes` in the URL
 * (sticks for the browsing session); turn off with `?changes=off`.
 * Wraps key changed/new phrases in a yellow <mark> so the edits are easy to
 * spot while reviewing. Safe to delete this file + the Layout.astro script
 * tag once the review round is done.
 */
(function () {
  var qs = new URLSearchParams(location.search);
  if (qs.get('changes') === 'off') sessionStorage.removeItem('sd-show-changes');
  else if (qs.has('changes')) sessionStorage.setItem('sd-show-changes', '1');
  if (sessionStorage.getItem('sd-show-changes') !== '1') return;

  /* Fragments are matched inside single text nodes, so they avoid spans that
     cross <em>/<strong> boundaries. Typographic apostrophes (’) match the
     rendered copy. */
  var PHRASES = [
    // Homepage & shared
    'You were born making',
    'Nobody does this to you. You do it',
    'The sound was always yours.',
    'You are the healer, and you are the',
    'Witnessed is different from watched.',
    'The healing is in the acknowledgment',
    'Nobody here will ask you to scream',
    'You cannot do it wrong',
    'Try a live workshop',
    'one live hour',
    'The occasional letter',
    'Nothing here needs you to be ready',
    // About & reviews
    'Upala',
    'expect a real relationship with your own voice',
    'A few words from people',
    'No miracles, on purpose',
    'different flavor of peace',
    // What is SVH
    'Most sound healing makes sound',
    'two small words',
    'Acknowledged things leave on their own',
    'what is below that?',
    'One tone is the whole instruction',
    'You arrive, you breathe, you settle.',
    'What about the neighbours?',
    'parked cars',
    'The voice will never',
    'built into the instrument',
    'Soft counts. Soft often counts double.',
    'There’s nothing I did.',
    // Workshop funnel
    'Guided sounding',
    'The questions people',
    'Do I need a good voice?',
    'Will I have to scream?',
    'Is this a sound bath?',
    'Live on Zoom',
    'Replay included',
    'The Zoom link and a calendar invite',
    'the door should be easy to open',
    'You don’t need a good voice. You need an honest one.',
    'The voice never lies.',
    'Nothing to prepare. Come as you sound.',
    'the giving direction',
    // Courses
    'allow, attend, acknowledge and integrate',
    'Grief is the river, not the knot',
    'An honest note',
    'Lift the head, relax the shoulders',
    'Grief is not the pain.',
    'How we think about healing',
    'finally be heard',
    'Small voice. Old truth. Finally heard.',
    'The high, small sounds',
    'I’m not being hurt — I’m being heard.',
    'First the truth. Then the tune.',
    'singing from yourself, not instead of yourself',
    'Everything wants to be acknowledged',
    'Not singing — sounding. Not for you — of you.',
    'Ask about this journey',
    'one tone, today, in the kitchen',
    'What is the sound of this moment?',
    'something, rather than',
    'The first sound is the hardest',
    'Pepe',
    'SVH AI',
    'Practice Together',
    'tuning your ears to the emotion inside the tone',
    // Certification
    'Shock & the Body',
    'self-taught, self-certified',
    'Came to the work as a client',
    'A price for where you are',
    'below the floor where words are kept',
    'holds the question',
    'the line behind them',
    // German
    'der wirklichen Anerkennung',
    'darf von selbst gehen',
    'bis sie sich von selbst lösen',
    'erkenne sie an, statt sie wegzudrücken',
    'würdigst sie',
    'gib jedem Zentrum seinen eigenen Klang',
    'Geführtes Tönen',
    'Was gehört wurde, darf sich von selbst lösen.',
    'Wo diese Arbeit begann',
    'Es gibt nichts, was ich getan habe.',
    'Was dieser Kurs nicht ist',
    'Ersetzt das eine Therapie?',
    'Dieser Klang war immer deiner.',
    // Dutch (Gent)
    'We geven klank aan wat het systeem draagt',
    'we zingen hier niet, we klinken',
    'Wij maken ruimte; de rest gebeurt.',
    'Vraag naar een plaats',
    'Twaalf, niet meer',
    // Retreats
    'We make room. The rest happens.',
    'holds space with the voice, the piano, and the circle',
    'Facilitator & space holder',
    'Wild, and on their terms',
    'when the dolphins choose to come',
    'What if the dolphins don’t come?',
    'the music makes its own kind of stillness',
    // Forgiveness
    'has room to arrive',
    'Honoring what the words alone never reached.',
    'You can’t skip to the love. But it’s there.',
    'Will I have to make sounds out loud',
    'Is this therapy?',
    'Meeting the inner critic with sound',
    'Acknowledged. Honored. Returned to',
    'occasional letter — easy to leave',
  ];

  var style = document.createElement('style');
  style.textContent =
    'mark.sd-changed{background:#ffe83d;color:inherit;padding:0 2px;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.06)}';
  document.head.appendChild(style);

  function highlight(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK' || tag === 'TEXTAREA')
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !text.trim()) return;
      for (var i = 0; i < PHRASES.length; i++) {
        var idx = text.indexOf(PHRASES[i]);
        if (idx === -1) continue;
        var mark = document.createElement('mark');
        mark.className = 'sd-changed';
        var middle = node.splitText(idx);
        middle.splitText(PHRASES[i].length);
        mark.textContent = middle.nodeValue;
        middle.parentNode.replaceChild(mark, middle);
        return; // node was split; remaining text is covered by later passes
      }
    });
  }

  function run() {
    highlight(document.body);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  /* Second + third pass for client-rendered content (event cards, register
     widgets) and for text after the first match in a node. */
  setTimeout(run, 1200);
  setTimeout(run, 3000);
})();
