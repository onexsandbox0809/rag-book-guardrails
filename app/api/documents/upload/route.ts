import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import { extractPdfPages, chunkPageText } from "../../../../lib/pdf";
import { embedText } from "../../../../lib/rag";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are allowed." }, { status: 400 });
    }

    const maxMb = Number(process.env.MAX_FILE_SIZE_MB || 50);
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json({ error: `Maximum file size is ${maxMb} MB.` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const upload = await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "documents")
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

    if (upload.error) throw upload.error;

    const { data: signed } = await supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || "documents")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    const { data: doc, error: docError } = await supabase.from("documents").insert({
      file_name: file.name,
      title: file.name.replace(/\.pdf$/i, ""),
      storage_path: storagePath,
      file_url: signed?.signedUrl || null,
      file_size: file.size,
      status: "processing",
    }).select().single();

    if (docError) throw docError;

    // For a first version, process synchronously. For very large PDFs,
    // move this work to a background queue/server worker.
    const pages = await extractPdfPages(buffer);

    await supabase.from("documents").update({
      total_pages: pages.length,
    }).eq("id", doc.id);

    let chunkNumber = 0;
    for (const page of pages) {
      const chunks = chunkPageText(page.text);
      for (const content of chunks) {
        const embedding = await embedText(content);
        const { error } = await supabase.from("document_chunks").insert({
          document_id: doc.id,
          page_number: page.pageNumber,
          chunk_number: chunkNumber++,
          content,
          embedding,
        });
        if (error) throw error;
      }
    }

    await supabase.from("documents").update({ status: "ready" }).eq("id", doc.id);

    return NextResponse.json({
      document: { ...doc, total_pages: pages.length, status: "ready" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upload failed." }, { status: 500 });
  }
}
