import type { Lead } from "./types";

export type Qualidade = 0 | 1 | 2 | 3;

// 3: telefone + email + website · 2: telefone + (email ou website) · 1: só telefone · 0: sem telefone
export function qualidadeLead(l: Pick<Lead, "telefone" | "email" | "website">): Qualidade {
  if (!l.telefone) return 0;
  const extras = Number(Boolean(l.email)) + Number(Boolean(l.website));
  return (1 + extras) as Qualidade;
}

export function rotuloQualidade(q: Qualidade) {
  return q === 0 ? "Sem telefone" : "⭐".repeat(q);
}
