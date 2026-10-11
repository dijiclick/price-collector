/**
 * Gender for a product: what the NAME says outright, else the adapter's guess.
 *
 * Adapters stamp gender from the section a product was crawled under, which is
 * coarse — Beymen lists "Taba Erkek Sneaker" in a women's tree and "Kadın Güneş
 * Gözlüğü" under men, Lacoste/Puma/Superstep/M&S leave 13–34% unstamped — and
 * the assistant's gender filter is a hard one (`gender = $x`). A name that says
 * "Erkek", "Kadın" or "Kız Çocuk" is the retailer speaking about THIS product,
 * so it wins; a name that says nothing keeps the section's answer.
 *
 * Pure and platform-free: the collector writes with it and the backfill
 * (scripts/reclassify-products.mjs) re-runs it over stored rows.
 */
import { fold } from "./productTypes";

export type Gender = "kadin" | "erkek" | "cocuk";

// Turkish traps: "boy" is LENGTH ("Midi Boy", "Kabin Boy"), "bebek mavisi" is
// baby BLUE, "erkek yaka" is a classic shirt collar on women's shirts, and
// "girl" is a perfume ("Good Girl") or a print ("PowerPuff Girls") far more
// often than a size range.
const KID = /\b(?:erkek|kiz) (?:cocuk|bebek)|\bcocuk|\bbebek(?!\s*(?:mavi|pembe))|\bkids?\b|\bjunior\b|\bjr\b|\btoddler/;
const WOMAN = /\bkadin|\bbayan\b|\bwomen'?s?\b|\bwomens\b|\bladies\b/;
const MATERNITY = /\bmama\b|\bhamile|\bmaternity|\banne bebek/;
const MAN = /\berkek(?!\s+(?:cocuk|bebek|yaka))|\bmen'?s?\b|\bmens\b/;

/** The gender a product name states, or null when it states none (or both: "Kadın Erkek Unisex"). */
export function genderFromName(name: string | null | undefined): Gender | null {
  const n = fold(name ?? "").replace(/[^a-z0-9' ]+/g, " ");
  if (!n.trim()) return null;
  // Maternity and baby-care lines say "bebek" without being a child's size:
  // H&M's "MAMA … Bebek Taşıma Ceketi" is shelved for women, Zara's "MATERNITY
  // SET" and "Anne Bebek Çantası" for kids — and "mama önlüğü" is a baby BIB
  // (mama = baby food). The name cannot tell, so the section decides.
  if (MATERNITY.test(n)) return null;
  if (KID.test(n)) return "cocuk";
  const w = WOMAN.test(n);
  const m = MAN.test(n);
  if (/\bunisex\b/.test(n) || (w && m)) return null;
  return w ? "kadin" : m ? "erkek" : null;
}

/** Name first, then the adapter's section-derived gender. */
export function resolveGender(adapterGender: string | null | undefined, name: string | null | undefined): Gender | null {
  const fromName = genderFromName(name);
  if (fromName) return fromName;
  return adapterGender === "kadin" || adapterGender === "erkek" || adapterGender === "cocuk" ? adapterGender : null;
}
