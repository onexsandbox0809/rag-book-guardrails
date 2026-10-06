 "use client";

import { useEffect, useState } from "react";

type Doc = {
  id: string;
  file_name: string;
  title: string | null;
  file_url: string | null;
  total_pages: number | null;
  status: string;
};

type Source = {
  page: number;
  chapter?: string | null;
  section?: string | null;
  similarity: number;
};

export default function RagApp() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadDocs() {
    const r = await fetch("/api/documents");
    const data = await r.json();
    if (r.ok) setDocs(data.documents || []);
  }

  useEffect(() => { loadDocs(); }, []);

  async function upload() {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/documents/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Upload failed");
      setMessage(`Uploaded ${data.document.file_name}. Processing has started.`);
      setFile(null);
      await loadDocs();
    } catch (e: any) {
      setMessage(e.message);
    } finally { setBusy(false); }
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy(true); setAnswer(""); setSources([]); setMessage("");
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, documentId: documentId || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Question failed");
      setAnswer(data.answer);
      setSources(data.sources || []);
    } catch (e: any) {
      setMessage(e.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="container">
      <div className="header">
        <div>
          <h1 className="title">📚 RAG Book Assistant</h1>
          <div className="subtitle">Upload PDFs and ask questions with page-level references.</div>
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Upload PDF</h2>
          <div className="upload">
            <input type="file" accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <p>{file ? file.name : "Select a PDF file"}</p>
            <button className="btn" onClick={upload} disabled={!file || busy}>Upload & Process</button>
          </div>

          <h2 style={{marginTop:24}}>Documents</h2>
          {docs.length === 0 && <div className="status">No documents uploaded yet.</div>}
          {docs.map((d) => (
            <div className="doc" key={d.id}>
              <strong>{d.title || d.file_name}</strong>
              <div className="status">
                {d.total_pages ? `${d.total_pages} pages · ` : ""}{d.status}
              </div>
              <button className="btn secondary" style={{marginTop:8}}
                onClick={() => setDocumentId(d.id)}>
                {documentId === d.id ? "Selected" : "Ask this document"}
              </button>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Ask a question</h2>
          <div className="status" style={{marginBottom:10}}>
            Closed-book mode: answers are generated only from the selected book.
          </div>
          <select className="input" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">Select a book...</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id} disabled={d.status !== "ready"}>
                {d.title || d.file_name} {d.status !== "ready" ? `(${d.status})` : ""}
              </option>
            ))}
          </select>
          <textarea className="input" style={{marginTop:10}} value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What does the book say about credit risk?" />
          <button className="btn" style={{marginTop:10}} onClick={ask} disabled={busy || !documentId}>
            {busy ? "Working..." : "Ask"}
          </button>

          {message && <div className="success">{message}</div>}

          {answer && <>
            <h2 style={{marginTop:28}}>Answer</h2>
            <div className="answer">{answer}</div>

            <h2 style={{marginTop:24}}>📖 References</h2>
            {sources.map((s, i) => (
              <div className="source" key={`${s.page}-${i}`}>
                <strong>Page {s.page}</strong>
                {s.chapter && <> · {s.chapter}</>}
                {s.section && <> · {s.section}</>}
                <div className="status">Source relevance: {(s.similarity * 100).toFixed(0)}%</div>
              </div>
            ))}
          </>}
        </section>
      </div>
    </main>
  );
}
