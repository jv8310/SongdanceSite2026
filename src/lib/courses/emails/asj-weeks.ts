// The Authentic Singing Journey, week by week — the words of the weekly email.
//
// Recovered from the Drip series "Weekly sessions of the Year Course Authentic
// Singing" (Yavin & Upala, 2020–2022), which still read in customers' replies
// and in the test inbox — the Drip API does not expose email-series content.
// Each week was a short note: what the session is, where it came from, what it
// invites. That stays the shape here.
//
// Week 1 never had its own weekly email: the welcome carried session 1, and
// that is still how it works — the confirmation (./confirmation-emails.ts)
// opens Week 1 and the weekly series starts at Week 2, seven days later.
//
// What changed from the Drip copy, so it can be checked against the original:
//   • "Year Course" → "journey" throughout (the product's name since 2022), and
//     "To My Account" → a button that opens that week in the CiRCLE.
//   • Signed "Jacob" (the sessions were made by Yavin & Upala; the "we" in the
//     notes is the two of them, and the confirmation says so).
//   • Copy book, law 2 (acknowledgment, never "letting go" as the mechanism):
//     week 15 ("What are you ready to surrender to the fire?" — the fire ritual
//     the book names as the thing that doesn't work) and week 19 ("liberating
//     our emotions") were rewritten.
//   • EXCEPT the "Let Go – Let In" trilogy (weeks 28–30) and week 31 after it:
//     Jacob's call (October 2026) is to keep their letting-go language as the
//     sessions were made — this is a singing journey, not the SVH practice the
//     copy book governs. Don't "fix" them.
//   • Week 7 "the best remedy" and "will stimulate your energy" → an invitation,
//     not an outcome (no outcome promises).
//   • Week 20 dropped its paragraph selling "The Mantra Collection" (now the PRO
//     mantra pack, which a buyer can't add on its own from the site).
//   • Weeks 11, 31, 33, 35 survive only in the Dutch series ("Authentiek Zingen
//     Week N"): translated from the Dutch, marked `translated`.
//   • Typos fixed ("a tender song is sang", a stray quote in week 9).
//
// Markup in `paragraphs`: plain text, plus [link text](/path) for a link to the
// site (resolved against the base URL when the email is built).

export type AsjWeek = {
  week: number;
  title: string;
  paragraphs: string[];
  // Where the words came from: the Drip email as it was, lightly edited (see
  // above), rewritten for the copy book, or translated from the Dutch series.
  source: 'drip' | 'drip-edited' | 'rewritten' | 'translated';
};

export const ASJ_WEEK_COUNT = 40;

export const ASJ_WEEKS: AsjWeek[] = [
  {
    week: 1,
    title: 'Discover Your Voice',
    source: 'drip-edited',
    paragraphs: [
      'Session 1 is called Discover Your Voice. It asks nothing of you but listening — to yourself, to the sound you already have. Do it as many times as you like: each time, it tends to bring something new.',
    ],
  },
  {
    week: 2,
    title: 'Enjoy Your Voice',
    source: 'drip-edited',
    paragraphs: [
      'Did you enjoy your first session — listening to yourself, discovering your voice? Feel free to do it as many times as you like. You may find it brings you something new each time.',
      "Ready for Week 2? Session 2 is called Enjoy Your Voice, and it's all about the joy of singing. In this session we focus on grounding and letting the energy flow through the entire body. You'll notice it is totally different from Session 1, and that's our aim: we want to offer a wide variety of approaches, musical genres and exercises. This week, we offer you an abundance of rhythm and energy. Enjoy!",
    ],
  },
  {
    week: 3,
    title: 'Imitate: African Chill',
    source: 'drip-edited',
    paragraphs: [
      'Here we are at Week 3. In Week 1 you listened to your voice, and in Week 2 you were singing and swinging to the music.',
      'This week is all about freeing your voice a little more, through the power of imitation.',
    ],
  },
  {
    week: 4,
    title: 'I Am Restful, I Am Peace',
    source: 'drip',
    paragraphs: [
      'At this point you’ve had three sessions in the “Step By Step” category. This week we’ll be doing the first session in the “Open Up” category.',
      'This session invites you to give sound to feelings of nervousness, stress and restlessness. Feel free to come back to it any time these feelings arise in your life.',
    ],
  },
  {
    week: 5,
    title: 'I Love My Body',
    source: 'drip',
    paragraphs: [
      'Singing without a body would be impossible, right? That’s why we often bring the focus to the body while making sound on this journey.',
      'This session is focused entirely on body awareness. The more you are connected with your body, the easier it is to sing authentically, and to be fully present with what is.',
    ],
  },
  {
    week: 6,
    title: 'Sing Your Love',
    source: 'drip',
    paragraphs: [
      'In Week 6 we have a very special session in store for you — one where you invite someone to join you…',
      'By sharing, the power of Authentic Singing becomes very real. That’s why, in this session, you are encouraged to invite someone you love to listen to your authentic voice. This can be a good friend, a partner, a child, a parent, or even someone you have just met.',
      'The session will lead you both into a beautiful, conscious presence. If the mere thought of this makes you fearful, think of this: you were born with a voice, and that voice is made to be heard. It’s not about being able to sing beautifully for someone, but simply about letting yourself be heard as you are in that moment.',
      'And you know what? Someone who loves you and is willing to listen without judgment will be touched by your courage and vulnerability, no matter what you sound like.',
      'And then love starts flowing… Sing Your Love…',
    ],
  },
  {
    week: 7,
    title: 'Rainforest Flow',
    source: 'drip-edited',
    paragraphs: [
      'Once in a while, it is common to have a day where our energy feels low or stagnant, or we may even feel somewhat down. What helps us most on those days is to start moving, to make sound, and to open up to a ‘shower of energy’ on the inside of the body.',
      'This week’s session invites your energy to flow freely through your body, with movement, breath and sound. However you are feeling, let your body and soul enjoy this rhythmic and dynamic song.',
    ],
  },
  {
    week: 8,
    title: 'The Morning',
    source: 'drip-edited',
    paragraphs: [
      'For Week 8 we have another ‘Step By Step’ session for you. We’ll bring you into a light meditative state, so you can listen in an open and receptive way and discover new ways of using your memory.',
      'In this session, a tender song is sung — a song for you and your inner child. If you feel the call to go deeper there, the [Inner Child Healing Journey](/courses/inner-child) is a whole journey of its own.',
    ],
  },
  {
    week: 9,
    title: 'Kyrie Eleison',
    source: 'drip-edited',
    paragraphs: [
      'When travelling through Europe you don’t have to look far to spot the most picturesque small churches and chapels.',
      'That’s where the inspiration for this session came from: an idyllic little church in Tuscany. This is the first session in the ‘Blossom’ category.',
    ],
  },
  {
    week: 10,
    title: 'Feel Now',
    source: 'drip-edited',
    paragraphs: [
      'You’ve made it to the first milestone.',
      'You are a quarter of the way through the Authentic Singing Journey. This is already the 10th week of letting your voice resound while you observe and explore its qualities. We want to congratulate you for that — and acknowledge your growing confidence.',
      'This week we invite you to deepen in sensitivity.',
    ],
  },
  {
    week: 11,
    title: 'Harmony 1: Acceptance Of Disharmony',
    source: 'translated',
    paragraphs: [
      'In Week 1 you listened to your own voice.',
      'This week you listen to your own voice once more — but this time in harmony with another instrument…',
    ],
  },
  {
    week: 12,
    title: 'Russian Delight',
    source: 'drip',
    paragraphs: [
      'This week we have a special treat from Russia.',
      'Yavinsky and his band bring us a session full of rhythm, energy and considerable virtuosity.',
    ],
  },
  {
    week: 13,
    title: 'Head Meets Heart',
    source: 'drip',
    paragraphs: [
      'Are you mostly following your head or your heart in life? Have you ever wondered what your head and your heart sound like? How different would their sound be?',
      'This session offers some interesting experiences to help you explore these questions…',
    ],
  },
  {
    week: 14,
    title: 'The Elements: Water',
    source: 'drip',
    paragraphs: [
      'In the coming weeks we bring you a few sessions in the ‘Blossom’ category. You’ll be guided to tune in to, and surrender to, the energy of the elements that surround and inspire us: Water, Fire, Air and Earth.',
    ],
  },
  {
    week: 15,
    title: 'The Elements: Fire',
    source: 'rewritten',
    paragraphs: [
      'This week we move our focus from water to fire!',
      'What in you carries the heat of fire — and what does it sound like when you let it sing?',
    ],
  },
  {
    week: 16,
    title: 'The Elements: Air',
    source: 'drip',
    paragraphs: [
      'This week, spoil yourself with the third session in the Blossom series on the elements. We focus on Air, and the wind will guide us…',
    ],
  },
  {
    week: 17,
    title: 'The Elements: Earth',
    source: 'drip-edited',
    paragraphs: ['We conclude the series on the elements with a mantra to our beloved planet, Mother Earth…'],
  },
  {
    week: 18,
    title: 'Harmony 2: The Sound Of The Mirror',
    source: 'drip',
    paragraphs: [
      'After four powerful Blossom sessions we’re ready again for a Step By Step session. You will be guided in what we call ‘mirror singing’, to reach new heights and depths and to broaden your sense of harmony.',
    ],
  },
  {
    week: 19,
    title: 'Melancholy',
    source: 'rewritten',
    paragraphs: [
      '‘Open Up’ sessions are all about giving our emotions a voice. This week we give sound to our feelings of melancholy…',
    ],
  },
  {
    week: 20,
    title: 'Calabash Freestyle',
    source: 'drip-edited',
    paragraphs: [
      'This is a special session, because you have reached Week 20. Congratulations! You are halfway through the Authentic Singing Journey.',
      'In this session you’ll be practising ‘the art of improvising and singing invented words’. Enjoy the adventurous nature and the joy of your inner child!',
      'Enjoy the session, and… here’s to the next 20 weeks!',
    ],
  },
  {
    week: 21,
    title: 'It’s Okay',
    source: 'drip',
    paragraphs: [
      'When tiredness strikes, it is good to rest. In this ‘Blossom’ session we explore rest as a source of inspiration and energy.',
    ],
  },
  {
    week: 22,
    title: 'Atlantis',
    source: 'drip',
    paragraphs: [
      'Did you hear your parents sing often? And do you know how your grandparents sounded? What songs did your ancestors sing — and are we able to bring those sounds back to life?',
    ],
  },
  {
    week: 23,
    title: 'My Song To The Whales',
    source: 'drip-edited',
    paragraphs: [
      'Along this journey it is natural to sometimes feel sadness while singing. During this ‘Open Up’ session, allow your sadness and grief to be expressed. Give it sound, and let it flow.',
    ],
  },
  {
    week: 24,
    title: 'Dance Of The Dolphins',
    source: 'drip-edited',
    paragraphs: [
      'Although this journey is all about Authentic Singing, we would like to introduce you to the power of Authentic Movement…',
    ],
  },
  {
    week: 25,
    title: 'Perfect As You Are',
    source: 'drip-edited',
    paragraphs: [
      'You look in the mirror several times a day, even if it’s just while brushing your teeth. But do you sometimes look consciously, and lovingly, at your own reflection?',
      'If the themes of this session are hard for you, you may feel the call of the [Inner Child Healing Journey](/courses/inner-child). Feel free to look into it and see whether it speaks to you — you will know if it’s right for you.',
    ],
  },
  {
    week: 26,
    title: 'The Gospel Of Awareness',
    source: 'drip',
    paragraphs: [
      'Gospel music has a special place in our hearts. It holds many elements we love: the energetic momentum of the African rhythms, harmonies that let us improvise effortlessly, and above all a devotion to that which transcends the small self…',
      'We have created our own take on the gospel genre — and once again bring you a distinct and unique session.',
    ],
  },
  {
    week: 27,
    title: 'The Echo Of Silence',
    source: 'drip',
    paragraphs: [
      'This session was created in a hilly Moroccan area between Marrakech and Essaouira, surrounded by the stillness and beauty of the landscape. The local people live a simple lifestyle and the children play cheerfully in the streets. Goods are transported from one village to another by mule.',
      'Admittedly, it is not an easy life for the locals… There is a lot of poverty and unemployment, and yet it is inspiring to see how many live a life of joy, surrendered to its natural flow.',
      'This, together with the stunning landscape, inspired us to make the session ‘The Echo of Silence’…',
    ],
  },
  {
    week: 28,
    title: 'Let It Go',
    source: 'drip',
    paragraphs: [
      'The first session of the trilogy ‘Let Go – Let In’.',
      'During this session, we invite you to give sound to the whispers of your soul as it tells you what to let go of, what no longer serves you…',
    ],
  },
  {
    week: 29,
    title: 'The Wisdom Of Your Voice',
    source: 'drip',
    paragraphs: [
      'Last week you received the first session from the ‘Let Go – Let In’ trilogy. This week we go a little deeper into the practice of letting go, and tune in to the wisdom of your voice.',
    ],
  },
  {
    week: 30,
    title: 'Bring In The New',
    source: 'drip',
    paragraphs: [
      'In the first two sessions of this trilogy we created space for letting go. In this third and final session of the trilogy ‘Let Go – Let In’, we focus on welcoming in new energy — filling ourselves up with freshness, new ideas, new inspiration and new strength…',
      'Feel free to return to these sessions whenever there is something you would like to let go of.',
    ],
  },
  {
    week: 31,
    title: 'Expectation & Disappointment',
    source: 'translated',
    paragraphs: [
      'The trilogy around letting go is behind us. Now it is a matter of waiting to see what the ‘result’ will be… Did you manage to truly let go of something? Did you manage to change something fundamental in your life?',
      'With all those questions, dreams and expectations arise all by themselves. And then disappointment lurks around the corner… Wouldn’t it be a gift to be able to embrace that disappointment, as a wondrous part of the human experience…',
    ],
  },
  {
    week: 32,
    title: 'My Fear',
    source: 'drip',
    paragraphs: ['It had to happen one day… a session about fear…', 'Are you up for it?'],
  },
  {
    week: 33,
    title: 'Cuban Style',
    source: 'translated',
    paragraphs: [
      'Rhythm hides in everything. When we let it move through us, energy starts to flow that we are otherwise often cut off from…',
    ],
  },
  {
    week: 34,
    title: 'Harmony 3: The Sound Of You',
    source: 'drip',
    paragraphs: [
      'We are pleased to bring you the last of the three sessions in the Harmony series. We’ll continue to build on the previous sessions and explore the creative path that unfolds between sounding harmoniously together and developing your own melody…',
    ],
  },
  {
    week: 35,
    title: 'Anger: It Is Time',
    source: 'translated',
    paragraphs: [
      'With only five sessions to go until the end of the journey, our friend ‘anger’ simply couldn’t be missing…',
      'Are you in touch with your anger? And did you know that anger and love can go hand in hand?',
    ],
  },
  {
    week: 36,
    title: 'Dark Forest',
    source: 'drip',
    paragraphs: [
      'A singing trip through the dark forest, towards the darkest place within ourselves…',
      'Dark forest, show me your light!',
    ],
  },
  {
    week: 37,
    title: 'All You Need Is',
    source: 'drip',
    paragraphs: [
      'Life gives us so much to be grateful for. So it is nice to sing a song to give thanks for all the little things that are given to us.',
    ],
  },
  {
    week: 38,
    title: 'Therefore I Forgive',
    source: 'drip-edited',
    paragraphs: [
      'We’re getting close to the end of the journey, but we’re not quite there! We still have some rich sessions in store to conclude our time together. This week we focus on the powerful act… to forgive.',
    ],
  },
  {
    week: 39,
    title: 'On Our Way',
    source: 'drip',
    paragraphs: [
      'We couldn’t finish this journey without a session on trust! For this penultimate session, we would like to offer you a powerful tribute to ‘being on the path that we all walk’. Trust is not so much an absence of doubt or fear, but rather living with a deeper knowing that, despite our doubts and fears, we are always on our way…',
    ],
  },
  {
    week: 40,
    title: 'Here And Now',
    source: 'drip-edited',
    paragraphs: [
      'We bow to you deeply, and thank you wholeheartedly for the trust you have placed in this Authentic Singing Journey!',
      'You. Made. It.',
      'Enjoy this celebratory session… Week 40.',
      'All forty sessions stay yours for life — come back to any of them, whenever your voice asks for it.',
    ],
  },
];

export function asjWeek(n: number): AsjWeek | null {
  return ASJ_WEEKS.find((w) => w.week === n) ?? null;
}

// The session thumbnail from the R2 library — the same image the course page
// shows for that week. Week 29 is the English-edition file.
export function asjWeekImagePath(n: number): string {
  return `/media/library/${n === 29 ? 'asj-week29en' : `asj-week${n}`}.webp`;
}
