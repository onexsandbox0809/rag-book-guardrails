# Closed-Book Guardrails

This application is deliberately NOT a general-purpose chatbot.

## Enforcement layers

### 1. Document selection
The API requires a `documentId`. A question cannot be answered without selecting a book.

### 2. Document isolation
The vector search receives `filter_document_id`, so chunks from other uploaded books are not eligible for retrieval.

### 3. Similarity threshold
Only retrieved chunks with similarity >= `RAG_SIMILARITY_THRESHOLD` are passed to the LLM.

Default:

```env
RAG_SIMILARITY_THRESHOLD=0.75
```

This should be evaluated against your actual book. A threshold that is too high can reject valid questions; one that is too low can admit weak evidence.

### 4. Closed-book system prompt
The LLM is explicitly instructed to use only the retrieved excerpts and reject unsupported questions.

### 5. Prompt-injection resistance
User messages cannot change the assistant's role or source-of-truth rules. Attempts such as "ignore previous instructions" are treated as ordinary user text.

### 6. Page citations
The LLM is required to cite pages. The API also returns the source page metadata independently of the generated answer.

## Expected behavior

Question in book:
- Answer
- Cite pages

Question outside book:
- Refuse

Question with weak retrieval:
- Refuse

No book selected:
- Refuse

Book still processing:
- Refuse

Prompt injection:
- Ignore the instruction and stay closed-book

## Important

Semantic similarity is not a perfect classifier. Before production, test the threshold using a set of:
- in-book questions
- paraphrased in-book questions
- near-topic but unsupported questions
- completely unrelated questions
- prompt-injection attempts

For stronger enterprise controls, add a separate relevance classifier before retrieval and an answer-evidence checker after generation.
