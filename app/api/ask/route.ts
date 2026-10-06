import { NextResponse } from "next/server";
import { answerQuestion } from "../../../lib/rag";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const question = String(body.question || "").trim();
    const documentId = body.documentId ? String(body.documentId) : null;

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const result = await answerQuestion(question, documentId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Ask failed." }, { status: 500 });
  }
}
