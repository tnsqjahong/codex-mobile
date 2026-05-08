const MODEL_LABEL_PARTS: Record<string, string> = {
  gpt: "GPT",
  codex: "Codex",
  spark: "Spark",
  mini: "Mini",
}

export function modelValue(model: any): string {
  return String(model?.model || model?.id || "").trim()
}

export function formatModelLabel(value: string): string {
  const raw = String(value || "").trim()
  if (!raw) return "default"
  return raw
    .split("-")
    .map((part) => MODEL_LABEL_PARTS[part.toLowerCase()] || part)
    .join("-")
}

export function modelDisplayName(model: any, fallback = "default"): string {
  return formatModelLabel(String(model?.displayName || modelValue(model) || fallback))
}
