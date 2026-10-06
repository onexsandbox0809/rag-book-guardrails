# RAG Book Assistant

A Next.js + Supabase + OpenAI RAG application for uploading PDF books and answering questions with page-level citations.

## Stack

- Next.js
- Vercel
- Supabase PostgreSQL
- Supabase Storage
- pgvector
- OpenAI embeddings
- OpenAI chat model
- GitHub

## 1. Create Supabase project

Create a Supabase project and open SQL Editor.

Run:

```sql
-- Paste the contents of supabase/schema.sql
```

The schema creates:

- `documents`
- `document_chunks`
- pgvector similarity search function
- `documents` storage bucket

For production, add Supabase Auth and Storage RLS policies. This starter uses the service role key only on the server.

## 2. Create OpenAI API key

Create an API key and put it in `.env.local`.

## 3. Configure environment

Copy:

```bash
cp .env.local.example .env.local
```

Fill:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
SUPABASE_STORAGE_BUCKET=documents
EMBEDDING_MODEL=text-embedding-3-small
CHAT_MODEL=gpt-5-mini
MAX_FILE_SIZE_MB=50
```

## 4. Install and run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## 5. Deploy to Vercel

Push this folder to GitHub:

```bash
git init
git add .
git commit -m "Initial RAG book assistant"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

Import the repository into Vercel.

Add the same environment variables in:

Vercel → Project → Settings → Environment Variables

Then deploy.

## Important production note

The included upload endpoint processes embeddings synchronously. This is fine for a prototype and smaller PDFs, but a 400-page book can exceed a serverless request duration depending on PDF size and number of chunks.

For production-scale 400+ page documents, use:

Browser upload → Supabase Storage → create processing job → background worker/queue → page extraction → batch embeddings → pgvector.

The database schema is already suitable for that upgrade.

## Page citations

Every chunk stores `page_number`. Retrieval returns page metadata, and the LLM is instructed to cite pages. This is the key mechanism that lets users go back to the original book.

## Security

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.

For a production multi-user deployment, add Supabase Auth, Row Level Security, per-user document ownership, private Storage policies, and signed URLs.


## Closed-book mode

See `GUARDRAILS.md`. The application requires a selected document, filters vector search to that document, applies a similarity threshold, and uses a strict closed-book system prompt. It refuses unsupported questions rather than answering from general model knowledge.
