// Shared shape for the registration calendar entries built in workshop.astro
// and rendered by WERegister.astro.
export interface CalItem {
  slug: string;
  kind: 'workshop' | 'masterclass';
  whenLocal: string | null;
  // UTC start instant (ISO-8601), so the client can re-render the displayed
  // time when the visitor switches timezone. Null for replay (no fixed time).
  startsAtUtc: string | null;
  isReplay: boolean;
  title: string;
  durationMin: number;
  priceLabel: string;
  priceMinor: number;
  currency: string;
  // Fixed price points per currency (minor units), for instant country/currency
  // switching on the client. Always includes at least EUR.
  pricesByCurrency: Record<string, number>;
  bumpName: string;
  bumpLabel: string;
  bumpMinor: number;
  bumpPricesByCurrency: Record<string, number>;
  // Marketing "regular price" anchor (minor units, per currency) for the struck
  // compare-at price beside the one-time offer. Empty when there's no bump.
  bumpComparePricesByCurrency: Record<string, number>;
  hasBump: boolean;
}
