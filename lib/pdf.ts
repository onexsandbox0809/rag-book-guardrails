import pdf from "pdf-parse";

export type PdfPage = {
  pageNumber: number;
  text: string;
  chapter: string | null;
  section: string | null;
};

/**
 * Reconstruct readable lines from PDF text items.
 *
 * The current implementation joins everything into one line.
 * This version uses the Y position of PDF text items so that
 * headings can be detected more reliably.
 */
function reconstructLines(items: any[]): string[] {
  const rows: {
    y: number;
    x: number;
    text: string;
  }[] = [];

  for (const item of items) {
    const text = String(item.str || "").trim();

    if (!text) continue;

    const transform = item.transform || [];

    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);

    rows.push({
      x,
      y,
      text,
    });
  }

  // Group text items that are on approximately the same Y position.
  const lineGroups: {
    y: number;
    items: {
      x: number;
      text: string;
    }[];
  }[] = [];

  for (const item of rows) {
    let group = lineGroups.find(
      (g) => Math.abs(g.y - item.y) < 3
    );

    if (!group) {
      group = {
        y: item.y,
        items: [],
      };

      lineGroups.push(group);
    }

    group.items.push({
      x: item.x,
      text: item.text,
    });
  }

  // PDF coordinates normally start from bottom,
  // so sort from top to bottom.
  lineGroups.sort((a, b) => b.y - a.y);

  return lineGroups
    .map((group) => {
      group.items.sort((a, b) => a.x - b.x);

      return group.items
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter(Boolean);
}

/**
 * Detect a chapter heading.
 *
 * Examples:
 * CHAPTER 2
 * CHAPTER 3
 * CHAPTER 10
 */
function isChapterNumber(line: string): boolean {
  return /^chapter\s+(\d+|[ivxlcdm]+)$/i.test(
    line.trim()
  );
}

/**
 * Detect a combined chapter heading.
 *
 * Example:
 * CHAPTER 2 COSTING TECHNIQUES
 */
function extractCombinedChapter(
  line: string
): string | null {
  const match = line.match(
    /^chapter\s+(\d+|[ivxlcdm]+)\s+(.+)$/i
  );

  if (!match) return null;

  const number = match[1];
  const title = match[2]
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return null;

  return `Chapter ${number} - ${title}`;
}

/**
 * Clean PDF heading text.
 *
 * Some PDFs extract headings like:
 *
 * C O S T I N G T E C H N I Q U E S
 *
 * Convert that into:
 *
 * COSTING TECHNIQUES
 */
function cleanHeading(text: string): string {
  let value = text
    .replace(/\s+/g, " ")
    .trim();

  // Detect spaced-out capital letters.
  const spacedLetters =
    value.match(
      /^(?:[A-Z]\s+){3,}[A-Z]$/
    );

  if (spacedLetters) {
    value = value.replace(/\s+/g, "");
  }

  return value;
}

/**
 * Heuristic to identify likely section headings.
 *
 * This intentionally avoids treating normal paragraphs
 * as sections.
 */
function isLikelySectionHeading(
  line: string
): boolean {
  const value = cleanHeading(line);

  if (!value) return false;

  // Too long to normally be a heading.
  if (value.length > 120) return false;

  // Very short text is normally not a useful heading.
  if (value.length < 3) return false;

  // Ignore bullets.
  if (
    /^[●•○▪◦\-*]/.test(value)
  ) {
    return false;
  }

  // Ignore numbered questions / steps.
  if (
    /^\d+[\.\)]\s/.test(value)
  ) {
    return false;
  }

  // Ignore sentences ending with punctuation.
  if (
    /[.!?]$/.test(value)
  ) {
    return false;
  }

  // Known heading patterns commonly used in the book.
  const headingPatterns = [
    /^what\s+is\b/i,
    /^why\s+is\b/i,
    /^why\s+are\b/i,
    /^basic\s+terms\b/i,
    /^steps\s+in\b/i,
    /^traditional\s+costing\b/i,
    /^advantages\b/i,
    /^disadvantages\b/i,
    /^advantages\s+and\s+disadvantages\b/i,
    /^target\s+costing\b/i,
    /^lifecycle\s+costing\b/i,
    /^use\s+of\b/i,
    /^summary\b/i,
    /^glossary\b/i,
    /^practice\s+questions\b/i,
    /^case\s+study\b/i,
    /^practical\s+applications\b/i,
    /^common\s+mistakes\b/i,
    /^allocation\b/i,
    /^bases\s+of\b/i,
    /^activity[- ]based\s+costing\b/i,
  ];

  if (
    headingPatterns.some(
      (pattern) =>
        pattern.test(value)
    )
  ) {
    return true;
  }

  // ALL CAPS headings.
  const lettersOnly =
    value.replace(
      /[^A-Za-z]/g,
      ""
    );

  if (
    lettersOnly.length >= 4 &&
    lettersOnly ===
      lettersOnly.toUpperCase()
  ) {
    return true;
  }

  // Title Case heading heuristic.
  const words = value.split(/\s+/);

  const capitalizedWords =
    words.filter((word) =>
      /^[A-Z][A-Za-z'()/-]*$/.test(
        word
      )
    ).length;

  if (
    words.length <= 10 &&
    capitalizedWords /
      words.length >=
      0.6
  ) {
    return true;
  }

  return false;
}

/**
 * Extract chapter and section information from one page.
 */
function extractPageStructure(
  lines: string[],
  previousChapter: string | null,
  previousSection: string | null
): {
  chapter: string | null;
  section: string | null;
} {
  let chapter =
    previousChapter;

  let section =
    previousSection;

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const rawLine =
      lines[i];

    const line =
      cleanHeading(rawLine);

    if (!line) continue;

    // -------------------------------------------------------
    // Chapter detection
    // -------------------------------------------------------

    const combinedChapter =
      extractCombinedChapter(
        line
      );

    if (combinedChapter) {
      chapter =
        combinedChapter;

      section = null;

      continue;
    }

    if (
      isChapterNumber(line)
    ) {
      const nextLine =
        lines[i + 1]
          ? cleanHeading(
              lines[i + 1]
            )
          : "";

      if (
        nextLine &&
        !isChapterNumber(
          nextLine
        )
      ) {
        chapter =
          line
            .replace(
              /^chapter/i,
              "Chapter"
            ) +
          " - " +
          nextLine;

        section = null;

        i++;

        continue;
      }
    }

    // -------------------------------------------------------
    // Section detection
    // -------------------------------------------------------

    if (
      isLikelySectionHeading(
        line
      )
    ) {
      // Don't treat the chapter title itself as a section.
      if (
        chapter &&
        line.toLowerCase() ===
          chapter
            .split(" - ")
            .slice(1)
            .join(" - ")
            .toLowerCase()
      ) {
        continue;
      }

      section = line;
    }
  }

  return {
    chapter,
    section,
  };
}

/**
 * Extract pages from PDF.
 */
export async function extractPdfPages(
  buffer: Buffer
): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];

  let currentChapter:
    | string
    | null = null;

  let currentSection:
    | string
    | null = null;

  await pdf(buffer, {
    pagerender: async (
      pageData: any
    ) => {
      const pageNumber =
        pages.length + 1;

      const renderOptions = {
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      };

      const textContent =
        await pageData.getTextContent(
          renderOptions
        );

      const lines =
        reconstructLines(
          textContent.items
        );

      const structure =
        extractPageStructure(
          lines,
          currentChapter,
          currentSection
        );

      currentChapter =
        structure.chapter;

      currentSection =
        structure.section;

      const text =
        lines
          .join("\n")
          .replace(
            /\n{3,}/g,
            "\n\n"
          )
          .trim();

      pages.push({
        pageNumber,
        text,
        chapter:
          currentChapter,
        section:
          currentSection,
      });

      return text;
    },
  });

  return pages;
}

/**
 * Chunk page text.
 */
export function chunkPageText(
  text: string,
  targetChars = 4200,
  overlapChars = 500
): string[] {
  const clean =
    text
      .replace(/\s+/g, " ")
      .trim();

  if (!clean) return [];

  const chunks: string[] = [];

  let start = 0;

  while (
    start < clean.length
  ) {
    let end = Math.min(
      start + targetChars,
      clean.length
    );

    if (
      end < clean.length
    ) {
      const boundary =
        clean.lastIndexOf(
          ". ",
          end
        );

      if (
        boundary >
        start +
          targetChars *
            0.65
      ) {
        end =
          boundary + 1;
      }
    }

    chunks.push(
      clean
        .slice(
          start,
          end
        )
        .trim()
    );

    if (
      end >= clean.length
    ) {
      break;
    }

    start = Math.max(
      0,
      end - overlapChars
    );
  }

  return chunks;
}