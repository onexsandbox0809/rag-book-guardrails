import { getOpenAI } from "./openai";
import { getSupabaseAdmin } from "./supabase-admin";

export type Source = {
  page: number;
  chapter?: string | null;
  section?: string | null;
  similarity: number;
  chunkId: string;
};

export async function embedText(text: string) {
  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

export async function answerQuestion(
  question: string,
  documentId?: string | null
) {
  const supabase = getSupabaseAdmin();
  const openai = getOpenAI();

  if (!documentId) {
    return {
      answer: "Please select a book before asking a question.",
      sources: [],
      refused: true,
      reason: "NO_DOCUMENT_SELECTED",
    };
  }

  // ---------------------------------------------------------
  // 1. Verify selected document
  // ---------------------------------------------------------

  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("id,title,file_name,status")
    .eq("id", documentId)
    .single();

  if (docError || !document) {
    return {
      answer: "The selected book could not be found.",
      sources: [],
      refused: true,
      reason: "DOCUMENT_NOT_FOUND",
    };
  }

  if (document.status !== "ready") {
    return {
      answer: `The selected book is not ready yet. Current status: ${document.status}.`,
      sources: [],
      refused: true,
      reason: "DOCUMENT_NOT_READY",
    };
  }

  const bookTitle = document.title || document.file_name;

  // ---------------------------------------------------------
  // 2. Create query embedding
  // ---------------------------------------------------------

  const queryEmbedding = await embedText(question);

  // ---------------------------------------------------------
  // 3. VECTOR SEARCH
  // ---------------------------------------------------------

  const { data: vectorMatches, error: vectorError } =
    await supabase.rpc("match_document_chunks", {
      query_embedding: queryEmbedding,
      match_count: 12,
      filter_document_id: documentId,
    });

  if (vectorError) {
    throw new Error(
      `Vector search failed: ${vectorError.message}`
    );
  }

  // ---------------------------------------------------------
  // 4. KEYWORD SEARCH
  // ---------------------------------------------------------

  const { data: keywordMatches, error: keywordError } =
    await supabase.rpc("search_document_chunks_keyword", {
      search_query: question,
      match_count: 12,
      filter_document_id: documentId,
    });

  if (keywordError) {
    console.error(
      "Keyword search failed:",
      keywordError.message
    );
  }

  // ---------------------------------------------------------
  // 5. COMBINE VECTOR + KEYWORD RESULTS
  // ---------------------------------------------------------

  const combined = new Map<string, any>();

  for (const row of vectorMatches || []) {
    combined.set(row.id, {
      ...row,
      vectorSimilarity: Number(row.similarity || 0),
      keywordScore: 0,
    });
  }

  for (const row of keywordMatches || []) {
    const existing = combined.get(row.id);

    if (existing) {
      existing.keywordScore = Number(
        row.keyword_score || 0
      );
    } else {
      combined.set(row.id, {
        ...row,
        vectorSimilarity: 0,
        keywordScore: Number(
          row.keyword_score || 0
        ),
      });
    }
  }

  // ---------------------------------------------------------
  // 6. SCORE RESULTS
  // ---------------------------------------------------------

  const ranked = Array.from(combined.values()).map((row) => {

    const vectorScore = Number(
      row.vectorSimilarity || 0
    );

    const keywordScore = Number(
      row.keywordScore || 0
    );

    /*
      Vector similarity normally ranges between 0 and 1.

      Keyword score from PostgreSQL is usually much smaller,
      so we normalize it before combining.
    */

    const normalizedKeywordScore =
      Math.min(keywordScore * 5, 1);

    const finalScore =
      vectorScore * 0.75 +
      normalizedKeywordScore * 0.25;

    return {
      ...row,
      finalScore,
    };
  });

  ranked.sort(
    (a, b) => b.finalScore - a.finalScore
  );

  // Take the best evidence.
  const selectedMatches = ranked.slice(0, 8);
  console.log("========== RAG DEBUG ==========");
console.log("Question:", question);
console.log("Document ID:", documentId);
console.log("Vector results:", vectorMatches?.length || 0);
console.log("Keyword results:", keywordMatches?.length || 0);

console.log(
  "Ranked results:",
  ranked.slice(0, 8).map((r) => ({
    id: r.id,
    page: r.page_number,
    vectorSimilarity: r.vectorSimilarity,
    keywordScore: r.keywordScore,
    finalScore: r.finalScore,
    contentPreview: String(r.content || "").substring(0, 200),
  }))
);

console.log("================================");

  // ---------------------------------------------------------
  // 7. IMPORTANT:
  // Do NOT reject merely because vector similarity is < 0.75
  // ---------------------------------------------------------

if (!selectedMatches.length) {
  return {
    answer: `I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic in the book.`,

    sources: [],

    refused: true,

    reason: "INSUFFICIENT_BOOK_EVIDENCE",

    debug: {
      question,
      documentId,
      vectorResults: vectorMatches?.length || 0,
      keywordResults: keywordMatches?.length || 0,

      rankedResults: ranked.slice(0, 8).map((r) => ({
        id: r.id,
        page: r.page_number,
        vectorSimilarity: r.vectorSimilarity,
        keywordScore: r.keywordScore,
        finalScore: r.finalScore,
        contentPreview: String(r.content || "").substring(0, 300),
      })),
    },
  };
}

  // ---------------------------------------------------------
  // 8. Build context
  // ---------------------------------------------------------

  const context = selectedMatches
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

Content:
${r.content}`
    )
    .join("\n\n--------------------------------\n\n");

  // ---------------------------------------------------------
  // 9. Send evidence to OpenAI
  // ---------------------------------------------------------

  const completion =
    await openai.chat.completions.create({
      model:
        process.env.CHAT_MODEL || "gpt-5-mini",

      messages: [
        {
          role: "system",

          content: `You are a CLOSED-BOOK document assistant.

The selected book is:

"${bookTitle}"

You MUST answer using ONLY the supplied book excerpts.

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
10. If the excerpts genuinely do not contain enough information, say:

"I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic in the book."

IMPORTANT:
Do not refuse simply because a vector similarity score is low.
The supplied excerpts have already been selected using both semantic
and keyword retrieval.`,
        },

        {
          role: "user",

          content: `Question:

${question}

BOOK EXCERPTS:

${context}

Answer the question using only the above excerpts.
Include the relevant page reference.`,
        },
      ],
    });

  // ---------------------------------------------------------
  // 10. Get answer
  // ---------------------------------------------------------

  const answer =
    completion.choices[0]?.message?.content ||
    `I can only answer questions based on "${bookTitle}". I couldn't find sufficient information about this topic in the book.`;

  // ---------------------------------------------------------
  // 11. Return references
  // ---------------------------------------------------------

  const sources: Source[] =
    selectedMatches.map((r) => ({
      page: r.page_number,
      chapter: r.chapter,
      section: r.section,
      similarity: Number(
        r.vectorSimilarity || r.finalScore || 0
      ),
      chunkId: r.id,
    }));

  return {
  answer,
  sources,
  refused: false,
  reason: null,

  debug: {
    question,
    documentId,
    vectorResults: vectorMatches?.length || 0,
    keywordResults: keywordMatches?.length || 0,

    rankedResults: ranked.slice(0, 8).map((r) => ({
      id: r.id,
      page: r.page_number,
      vectorSimilarity: r.vectorSimilarity,
      keywordScore: r.keywordScore,
      finalScore: r.finalScore,
      contentPreview: String(r.content || "").substring(0, 300),
    })),
  },
};