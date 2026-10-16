/**
 * PDF/menu upload pipeline (P09.08.03 [G:LAUNCH], P09.08.04): quarantine →
 * malware scan → isolated-worker text extraction → Draft suggestions.
 * Imported content is untrusted: stored as data, injection markers flagged,
 * never auto-approved (INV-08). The live scanner adapter and worker wiring
 * ride separately; this module is the stage gate + draft builder.
 */

/** EICAR test string: the scanner must block it (P09.08.05-adjacent). */
export const EICAR_MARKER = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export type UploadStage = 'quarantined' | 'scanned' | 'extracted' | 'drafted' | 'blocked';

export interface UploadScan {
  readonly clean: boolean;
  readonly eicar: boolean;
}

/** Scan bytes: quarantine holds until clean; EICAR always blocks. */
export function scanUpload(bytes: string): UploadScan {
  const eicar = bytes.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
  return { clean: !eicar && bytes.length > 0, eicar };
}

export interface DraftSuggestion {
  readonly title: string;
  readonly body: string;
  readonly source: string;
  readonly injectionFlag: boolean;
}

/** Extraction runs isolated; output is data — drafts only, never approved. */
export function extractDrafts(text: string, source: string): readonly DraftSuggestion[] {
  const body = text.trim().slice(0, 2000);
  if (body.length === 0) return [];
  const injectionFlag = /ignore (all )?previous instructions|system:/i.test(body);
  const firstLine = body.split('\n')[0] ?? '';
  const title = firstLine.slice(0, 80);
  return [{ title, body, source, injectionFlag }];
}
