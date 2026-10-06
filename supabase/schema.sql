-- RAG Book: Supabase schema
create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  title text,
  storage_path text not null,
  file_url text,
  file_size bigint,
  total_pages integer,
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','ready','error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer not null,
  chapter text,
  section text,
  chunk_number integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists document_chunks_document_id_idx
  on document_chunks(document_id);

create index if not exists document_chunks_page_idx
  on document_chunks(document_id, page_number);

create index if not exists document_chunks_embedding_hnsw
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- Hybrid-friendly keyword index.
create index if not exists document_chunks_content_fts_idx
  on document_chunks using gin (to_tsvector('english', content));

create or replace function match_document_chunks(
  query_embedding vector(1536),
  match_count int default 8,
  filter_document_id uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  page_number integer,
  chapter text,
  section text,
  chunk_number integer,
  content text,
  similarity float
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.page_number,
    dc.chapter,
    dc.section,
    dc.chunk_number,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where dc.embedding is not null
    and (filter_document_id is null or dc.document_id = filter_document_id)
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- Create the storage bucket in Dashboard if you prefer. This SQL creates it too.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;


-- Optional production hardening:
-- Add user_id uuid references auth.users(id) to documents and document_chunks,
-- then enforce RLS so users can only retrieve their own documents.
-- The application already passes a specific document_id into the vector function.
