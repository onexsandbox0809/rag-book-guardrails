import { getOpenAI } from "./openai";
import { getSupabaseAdmin } from "./supabase-admin";

export type Source = {
  page: number;
  chapter?: string | null;
  section?: string | null;
  similarity: number;
  chunkId: string;
};

/**
 * Create an embedding for the user's question.
 */
export async function embedText(text: string) {
  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model:
      process.env.EMBEDDING_MODEL ||
      "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Answer a question using only the selected book.
 */
export async function answerQuestion(
  question: string,
  documentId?: string | null
) {
  const supabase = getSupabaseAdmin();
  const openai = getOpenAI();

  // ---------------------------------------------------------
  // 0. Validate input
  // ---------------------------------------------------------

  if (!documentId) {
    return {
      answer:
        "Please select a book before asking a question.",
      source1: null,
      source2: null,
      refused: true,
      reason: "NO_DOCUMENT_SELECTED",
    };
  }

  if (!question || !question.trim()) {
    return {
      answer:
        "Please enter a question.",
      source1: null,
      source2: null,
      refused: true,
      reason: "EMPTY_QUESTION",
    };
  }

  // ---------------------------------------------------------
  // 1. Verify selected document
  // ---------------------------------------------------------

  const {
    data: document,
    error: docError,
  } = await supabase
    .from("documents")
    .select(
      "id,title,file_name,status"
    )
    .eq("id", documentId)
    .single();

  if (docError || !document) {
    return {
      answer:
        "The selected book could not be found.",
      source1: null,
      source2: null,
      refused: true,
      reason: "DOCUMENT_NOT_FOUND",
    };
  }

  if (document.status !== "ready") {
    return {
      answer: `The selected book is not ready yet. Current status: ${document.status}.`,
      source1: null,
      source2: null,
      refused: true,
      reason: "DOCUMENT_NOT_READY",
    };
  }

  const bookTitle =
    document.title ||
    document.file_name ||
    "Selected book";

  // ---------------------------------------------------------
  // 2. Create embedding for the question
  // ---------------------------------------------------------

  const queryEmbedding =
    await embedText(question);

  // ---------------------------------------------------------
  // 3. VECTOR SEARCH
  // ---------------------------------------------------------

  const {
    data: vectorMatches,
    error: vectorError,
  } = await supabase.rpc(
    "match_document_chunks",
    {
      query_embedding: queryEmbedding,
      match_count: 12,
      filter_document_id: documentId,
    }
  );

  if (vectorError) {
    throw new Error(
      `Vector search failed: ${vectorError.message}`
    );
  }

  // ---------------------------------------------------------
  // 4. KEYWORD SEARCH
  // ---------------------------------------------------------

  let keywordMatches: any[] = [];

  const {
    data: keywordData,
    error: keywordError,
  } = await supabase.rpc(
    "search_document_chunks_keyword",
    {
      search_query: question,
      match_count: 12,
      filter_document_id: documentId,
    }
  );

  if (keywordError) {
    console.error(
      "Keyword search failed:",
      keywordError.message
    );
  } else {
    keywordMatches =
      keywordData || [];
  }

  // ---------------------------------------------------------
  // 5. COMBINE VECTOR + KEYWORD RESULTS
  // ---------------------------------------------------------

  const combined =
    new Map<string, any>();

  // Add vector results
  for (const row of vectorMatches || []) {
    combined.set(row.id, {
      ...row,
      vectorSimilarity: Number(
        row.similarity || 0
      ),
      keywordScore: 0,
    });
  }

  // Add keyword results
  for (const row of keywordMatches) {
    const existing =
      combined.get(row.id);

    if (existing) {
      existing.keywordScore =
        Number(
          row.keyword_score || 0
        );
    } else {
      combined.set(row.id, {
        ...row,
        vectorSimilarity: 0,
        keywordScore:
          Number(
            row.keyword_score || 0
          ),
      });
    }
  }

  // ---------------------------------------------------------
  // 6. RANK RESULTS
  // ---------------------------------------------------------

  const ranked =
    Array.from(
      combined.values()
    ).map((row) => {
      const vectorScore =
        Number(
          row.vectorSimilarity || 0
        );

      const keywordScore =
        Number(
          row.keywordScore || 0
        );

      /*
       * Vector relevance = 75%
       * Keyword relevance = 25%
       *
       * IMPORTANT:
       * This is only a ranking weight.
       * It is NOT a minimum similarity threshold.
       */

      const normalizedKeywordScore =
        Math.min(
          keywordScore * 5,
          1
        );

      const finalScore =
        vectorScore * 0.75 +
        normalizedKeywordScore * 0.25;

      return {
        ...row,
        finalScore,
      };
    });

  // Highest score first
  ranked.sort(
    (a, b) =>
      b.finalScore -
      a.finalScore
  );

  // ---------------------------------------------------------
  // 7. Select TOP 2 evidence only
  // ---------------------------------------------------------

  const selectedMatches =
    ranked.slice(0, 2);

  // ---------------------------------------------------------
  // 8. Debug information
  // ---------------------------------------------------------

  const debug = {
    question,
    documentId,

    vectorResults:
      vectorMatches?.length || 0,

    keywordResults:
      keywordMatches.length,

    rankedResults:
      ranked.slice(0, 2).map(
        (r) => ({
          id: r.id,
          page: r.page_number,
          chapter: r.chapter,
          section: r.section,
          vectorSimilarity:
            r.vectorSimilarity,
          keywordScore:
            r.keywordScore,
          finalScore:
            r.finalScore,
          contentPreview:
            String(
              r.content || ""
            ).substring(0, 300),
        })
      ),
  };

  console.log(
    "========== RAG DEBUG =========="
  );

  console.log(
    JSON.stringify(
      debug,
      null,
      2
    )
  );

  console.log(
    "================================"
  );

  // ---------------------------------------------------------
  // 9. No evidence found
  // ---------------------------------------------------------

  if (!selectedMatches.length) {
    return {
      answer: `I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic in the book.`,
      source1: null,
      source2: null,
      refused: true,
      reason:
        "INSUFFICIENT_BOOK_EVIDENCE",
      debug,
    };
  }

  // ---------------------------------------------------------
  // 10. Build context
  // ---------------------------------------------------------

  const context =
    selectedMatches
      .map(
        (r, i) =>
          `[SOURCE ${i + 1}]
Page: ${r.page_number}
${
  r.chapter
    ? `Chapter: ${r.chapter}\n`
    : ""
}${
  r.section
    ? `Section: ${r.section}\n`
    : ""
}Vector relevance: ${Number(
            r.vectorSimilarity || 0
          ).toFixed(3)}
Keyword relevance: ${Number(
            r.keywordScore || 0
          ).toFixed(3)}

Content:
${r.content}`
      )
      .join(
        "\n\n--------------------------------\n\n"
      );

  // ---------------------------------------------------------
  // 11. Ask OpenAI
  // ---------------------------------------------------------

  const completion =
    await openai.chat.completions.create(
      {
        model:
          process.env.CHAT_MODEL ||
          "gpt-5-mini",

        /*
         * Do NOT add temperature: 0 here.
         * Your selected model rejected temperature=0.
         */

        messages: [
          {
            role: "system",

            content: `You are a CLOSED-BOOK document assistant.

The selected book is:

"${bookTitle}"

You MUST answer the user's question using ONLY the supplied excerpts from this book.

RULES:

1. Use only information present in the supplied excerpts.
2. Do not use outside knowledge.
3. Do not invent facts.
4. Do not invent calculations.
5. Do not invent page numbers.
6. If the answer is present in the excerpts, answer it directly.
7. For calculation questions, show the calculation using the values from the book.
8. Always mention the relevant page number.
9. Keep the answer clear and concise.
10. If multiple excerpts contain relevant information, combine them.
11. If the exact wording of the question appears in the excerpts, use the corresponding answer.
12. Do not refuse simply because the vector similarity is below any particular number.

If the supplied excerpts genuinely do not contain enough information to answer the question, say:

"I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic in the book."`,
          },

          {
            role: "user",

            content: `Question:

${question}

BOOK EXCERPTS:

${context}

Answer the question using ONLY the above book excerpts.

For numerical questions:
- Show the relevant calculation.
- Give the final answer clearly.
- Mention the page number.

For definition questions:
- Give the definition from the book.
- Explain it briefly using the book's terminology.
- Mention the page number.`,
          },
        ],
      }
    );

  // ---------------------------------------------------------
  // 12. Extract answer
  // ---------------------------------------------------------

  const answer =
    completion.choices[0]
      ?.message?.content ||
    `I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic.`;

  // ---------------------------------------------------------
  // 13. Build SOURCE 1
  // ---------------------------------------------------------

  const source1: Source | null =
    selectedMatches.length > 0
      ? {
          page:
            selectedMatches[0]
              .page_number,

          chapter:
            selectedMatches[0]
              .chapter,

          section:
            selectedMatches[0]
              .section,

          similarity:
            Number(
              selectedMatches[0]
                .vectorSimilarity ||
                selectedMatches[0]
                  .finalScore ||
                0
            ),

          chunkId:
            selectedMatches[0].id,
        }
      : null;

  // ---------------------------------------------------------
  // 14. Build SOURCE 2
  // ---------------------------------------------------------

  const source2: Source | null =
    selectedMatches.length > 1
      ? {
          page:
            selectedMatches[1]
              .page_number,

          chapter:
            selectedMatches[1]
              .chapter,

          section:
            selectedMatches[1]
              .section,

          similarity:
            Number(
              selectedMatches[1]
                .vectorSimilarity ||
                selectedMatches[1]
                  .finalScore ||
                0
            ),

          chunkId:
            selectedMatches[1].id,
        }
      : null;

  // ---------------------------------------------------------
  // 15. Return answer
  // ---------------------------------------------------------

  return {
    answer,

    source1,

    source2,

    refused: false,

    reason: null,

    debug,
  };
}