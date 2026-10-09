export type Email = { address: string; mx: boolean | null };
export type Owner = { name: string; title: string };

export type Signals = {
  reachable: boolean;
  error?: string;
  pages: string[];
  title?: string;
  description?: string;
  emails: Email[];
  phones: string[];
  linkedin?: string;
  facebook?: string;
  owners: Owner[];
  foundedYear?: number;
  copyrightYear?: number;
  ownerOperated: boolean;
  generational: boolean;
  succession: boolean;
  franchise: boolean;
  hiring: boolean;
  onlineBooking: boolean;
};

export type Reason = { points: number; text: string };

export type Lead = {
  id: number;
  list: string;
  name: string;
  industry: string | null;
  domain: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  chain: number;
  status: "new" | "contacted" | "skip";
  score: number | null;
  tier: "A" | "B" | "C" | null;
  reasons: Reason[] | null;
  signals: Signals | null;
  opener: string | null;
  enriched_at: string | null;
};
