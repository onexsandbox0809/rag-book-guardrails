import pdf from "pdf-parse";

export type PdfPage = {
  pageNumber: number;
  text: string;
};

export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];

  await pdf(buffer, {
    pagerender: async (pageData: any) => {
      const pageNumber = pages.length + 1;
      const renderOptions = {
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      };

      const textContent = await pageData.getTextContent(renderOptions);
      const text = textContent.items
        .map((item: any) => item.str || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pages.push({ pageNumber, text });
      return text;
    },
  });

  return pages;
}

export function chunkPageText(
  text: string,
  targetChars = 4200,
  overlapChars = 500
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + targetChars, clean.length);

    if (end < clean.length) {
      const boundary = clean.lastIndexOf(". ", end);
      if (boundary > start + targetChars * 0.65) end = boundary + 1;
    }

    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;

    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}
