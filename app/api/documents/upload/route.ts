import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-admin";
import {
  extractPdfPages,
  chunkPageText,
} from "../../../../lib/pdf";
import { embedText } from "../../../../lib/rag";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    // ---------------------------------------------------------
    // 1. Validate uploaded file
    // ---------------------------------------------------------

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "PDF file is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      file.type !== "application/pdf" &&
      !file.name
        .toLowerCase()
        .endsWith(".pdf")
    ) {
      return NextResponse.json(
        {
          error:
            "Only PDF files are allowed.",
        },
        {
          status: 400,
        }
      );
    }

    // ---------------------------------------------------------
    // 2. Validate file size
    // ---------------------------------------------------------

    const maxMb = Number(
      process.env.MAX_FILE_SIZE_MB || 50
    );

    if (
      file.size >
      maxMb * 1024 * 1024
    ) {
      return NextResponse.json(
        {
          error: `Maximum file size is ${maxMb} MB.`,
        },
        {
          status: 400,
        }
      );
    }

    // ---------------------------------------------------------
    // 3. Supabase setup
    // ---------------------------------------------------------

    const supabase =
      getSupabaseAdmin();

    const bucket =
      process.env
        .SUPABASE_STORAGE_BUCKET ||
      "documents";

    const safeName =
      file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

    const storagePath =
      `${crypto.randomUUID()}-${safeName}`;

    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    // ---------------------------------------------------------
    // 4. Upload PDF to Supabase Storage
    // ---------------------------------------------------------

    const upload =
      await supabase.storage
        .from(bucket)
        .upload(
          storagePath,
          buffer,
          {
            contentType:
              "application/pdf",
            upsert: false,
          }
        );

    if (upload.error) {
      throw upload.error;
    }

    // ---------------------------------------------------------
    // 5. Generate signed URL
    // ---------------------------------------------------------

    const {
      data: signed,
      error: signedError,
    } =
      await supabase.storage
        .from(bucket)
        .createSignedUrl(
          storagePath,
          60 * 60 * 24 * 7
        );

    if (signedError) {
      throw signedError;
    }

    // ---------------------------------------------------------
    // 6. Create document record
    // ---------------------------------------------------------

    const {
      data: doc,
      error: docError,
    } = await supabase
      .from("documents")
      .insert({
        file_name: file.name,

        title: file.name.replace(
          /\.pdf$/i,
          ""
        ),

        storage_path:
          storagePath,

        file_url:
          signed?.signedUrl ||
          null,

        file_size:
          file.size,

        status:
          "processing",
      })
      .select()
      .single();

    if (docError) {
      throw docError;
    }

    // ---------------------------------------------------------
    // 7. Extract PDF pages
    // ---------------------------------------------------------

    const pages =
      await extractPdfPages(
        buffer
      );

    // ---------------------------------------------------------
    // 8. Update total pages
    // ---------------------------------------------------------

    const {
      error: pageUpdateError,
    } = await supabase
      .from("documents")
      .update({
        total_pages:
          pages.length,
      })
      .eq(
        "id",
        doc.id
      );

    if (pageUpdateError) {
      throw pageUpdateError;
    }

    // ---------------------------------------------------------
    // 9. Create chunks + embeddings
    // ---------------------------------------------------------

    let chunkNumber = 0;

    for (const page of pages) {
      const chunks =
        chunkPageText(
          page.text
        );

      for (const content of chunks) {
        const embedding =
          await embedText(
            content
          );

        const {
          error: chunkError,
        } = await supabase
          .from(
            "document_chunks"
          )
          .insert({
            // Document reference
            document_id:
              doc.id,

            // Page information
            page_number:
              page.pageNumber,

            // NEW: chapter metadata
            chapter:
              page.chapter,

            // NEW: section metadata
            section:
              page.section,

            // Chunk number
            chunk_number:
              chunkNumber++,

            // Actual chunk text
            content,

            // OpenAI embedding
            embedding,
          });

        if (chunkError) {
          throw chunkError;
        }
      }
    }

    // ---------------------------------------------------------
    // 10. Mark document as ready
    // ---------------------------------------------------------

    const {
      error: readyError,
    } = await supabase
      .from("documents")
      .update({
        status: "ready",
      })
      .eq(
        "id",
        doc.id
      );

    if (readyError) {
      throw readyError;
    }

    // ---------------------------------------------------------
    // 11. Return response
    // ---------------------------------------------------------

    return NextResponse.json({
      document: {
        ...doc,
        total_pages:
          pages.length,
        status: "ready",
      },
    });
  } catch (e: any) {
    console.error(
      "PDF upload/processing error:",
      e
    );

    return NextResponse.json(
      {
        error:
          e?.message ||
          "Upload failed.",
      },
      {
        status: 500,
      }
    );
  }
}