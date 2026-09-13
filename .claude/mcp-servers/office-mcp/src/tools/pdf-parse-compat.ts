/**
 * Compatibility shim: exposes the pdf-parse 1.x call shape
 * (`pdfParse(buffer) -> { text, numpages, version, info, metadata }`)
 * on top of pdf-parse 2.x, whose bundled pdf.js parses modern PDFs
 * that the 1.x line rejects ("Invalid PDF structure" / "bad XRef entry").
 */
import { PDFParse } from "pdf-parse";

export interface PdfParseResult {
  text: string;
  numpages: number;
  version: string;
  info: Record<string, unknown> | null;
  metadata: unknown;
}

export default async function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const info = (infoResult.info ?? null) as Record<string, unknown> | null;
    return {
      // Join per-page text directly so no page-separator banners leak into output.
      text: textResult.pages.map((p) => p.text).join("\n"),
      numpages: textResult.total,
      version: typeof info?.PDFFormatVersion === "string" ? info.PDFFormatVersion : "Unknown",
      info,
      metadata: infoResult.metadata ?? null,
    };
  } finally {
    await parser.destroy();
  }
}
