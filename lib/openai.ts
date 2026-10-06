import OpenAI from "openai";

export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({ apiKey: key });
}
