import type { GeoBairro } from "./nominatim";

export type EntradaHistorico = {
  bairro: string;
  cidade: string;
  data: string; // AAAA-MM-DD
  total: number;
  // undefined = ainda não consultado no Nominatim · null = não encontrado
  geo?: GeoBairro | null;
};

const CHAVE = "leadgen:historico";
const MAX_ENTRADAS = 50;

export const chaveBairro = (e: Pick<EntradaHistorico, "bairro" | "cidade">) =>
  `${e.bairro}|${e.cidade}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function hojeISO() {
  // sv-SE formata como AAAA-MM-DD
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

// Store sobre o localStorage para usar com useSyncExternalStore (também sincroniza entre abas)
const VAZIO: EntradaHistorico[] = [];
let snapshot: EntradaHistorico[] | null = null;
const ouvintes = new Set<() => void>();

function lerStorage(): EntradaHistorico[] {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(dados) ? dados : VAZIO;
  } catch {
    return VAZIO;
  }
}

export function historicoAtual() {
  snapshot ??= lerStorage();
  return snapshot;
}

export const historicoServidor = () => VAZIO;

export function assinarHistorico(ouvinte: () => void) {
  const aoMudarEmOutraAba = (e: StorageEvent) => {
    if (e.key !== CHAVE) return;
    snapshot = null;
    ouvinte();
  };
  ouvintes.add(ouvinte);
  window.addEventListener("storage", aoMudarEmOutraAba);
  return () => {
    ouvintes.delete(ouvinte);
    window.removeEventListener("storage", aoMudarEmOutraAba);
  };
}

export function atualizarHistorico(fn: (lista: EntradaHistorico[]) => EntradaHistorico[]) {
  snapshot = fn(historicoAtual());
  try {
    localStorage.setItem(CHAVE, JSON.stringify(snapshot));
  } catch {
    // localStorage cheio ou indisponível: mantém só em memória
  }
  ouvintes.forEach((o) => o());
}

// Coloca a busca no topo (substituindo a anterior do mesmo bairro) e mantém só as 50 mais recentes
export function registrarBusca(lista: EntradaHistorico[], nova: Omit<EntradaHistorico, "geo">) {
  const chave = chaveBairro(nova);
  const anterior = lista.find((e) => chaveBairro(e) === chave);
  return [{ ...nova, geo: anterior?.geo }, ...lista.filter((e) => chaveBairro(e) !== chave)]
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, MAX_ENTRADAS);
}

export function idadeDias(data: string) {
  const ms = Date.parse(hojeISO()) - Date.parse(data);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function rotuloIdade(dias: number) {
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

export type FaixaIdade = "recente" | "medio" | "antigo";

// < 7 dias: verde · 7–30: amarelo · > 30: cinza
export function faixaIdade(dias: number): FaixaIdade {
  if (dias < 7) return "recente";
  if (dias <= 30) return "medio";
  return "antigo";
}

export const COR_FAIXA: Record<FaixaIdade, string> = {
  recente: "#22c55e",
  medio: "#eab308",
  antigo: "#9ca3af",
};
