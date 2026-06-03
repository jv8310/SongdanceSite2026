// Shared shape for the registration calendar entries built in workshop.astro
// and rendered by WERegister.astro.
export interface CalItem {
  slug: string;
  kind: 'workshop' | 'masterclass';
  whenLocal: string | null;
  isReplay: boolean;
  title: string;
  priceLabel: string;
  priceMinor: number;
  currency: string;
  bumpName: string;
  bumpLabel: string;
  bumpMinor: number;
  hasBump: boolean;
}
