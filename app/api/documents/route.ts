import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("documents")
      .select("id,file_name,title,file_url,total_pages,status,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ documents: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
