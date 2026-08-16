import { createHash } from "node:crypto";

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

export function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|spm|ref|source|xsec_)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url.toString();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentFingerprints(input: { sourceType: string; externalId: string; canonicalUrl?: string | null; title: string; body?: string | null }) {
  return {
    external: `${input.sourceType}:${input.externalId}`,
    canonical: input.canonicalUrl ? sha256(normalizeCanonicalUrl(input.canonicalUrl)) : null,
    title: sha256(normalizeTitle(input.title)),
    body: input.body?.trim() ? sha256(input.body.normalize("NFKC").replace(/\s+/g, " ").trim()) : null,
  };
}
