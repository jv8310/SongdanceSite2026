// Shared shape for the registration calendar entries built in workshop.astro
// and rendered by WERegister.astro.
export interface CalItem {
  slug: string;
  kind: 'workshop' | 'masterclass';
  whenLocal: string | null;
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
  hasBump: boolean;
}
