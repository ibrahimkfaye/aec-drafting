/**
 * Document types this deployment supports. The pilot's real document type and
 * firm template are NOT confirmed yet (docs/ASSUMPTIONS.md A-03, Q-01); the
 * entry below is a clearly labeled development placeholder.
 */
export const DOCUMENT_TYPES = [
  {
    key: "sample_technical_memo",
    label: "Sample technical memorandum (development placeholder)",
  },
] as const;

export type DocumentTypeKey = (typeof DOCUMENT_TYPES)[number]["key"];

export function documentTypeLabel(key: string): string {
  return DOCUMENT_TYPES.find((d) => d.key === key)?.label ?? `Unknown type (${key})`;
}
