"use client";

import { useMemo, useState } from "react";
import {
  Building,
  Calendar,
  FileSpreadsheet,
  FileText,
  Funnel,
  Globe,
  Hash,
  LoaderCircle,
  Mail,
  MapPin,
  MapPinned,
  Phone,
  Search,
  Star,
  User,
  Users,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { qualidadeLead } from "@/lib/qualidade";

type FiltroTelefone = "todos" | "com" | "sem" | "completos";

const OPCOES_TELEFONE: [FiltroTelefone, string][] = [
  ["todos", "Todos"],
  ["com", "Com telefone"],
  ["sem", "Sem telefone"],
  ["completos", "⭐⭐⭐ Completos"],
];

function corSituacao(situacao?: string) {
  switch (situacao?.toLowerCase()) {
    case "ativa":
      return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
    case "baixada":
    case "nula":
      return "bg-red-500/15 text-red-400 ring-red-500/30";
    case "suspensa":
    case "inapta":
      return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
    default:
      return "bg-gray-500/15 text-gray-400 ring-gray-500/30";
  }
}

function formatarCnpj(c: string) {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatarData(d: string) {
  const [a, m, dia] = d.split("-");
  return dia ? `${dia}/${m}/${a}` : d;
}

function Estrelas({ n }: { n: number }) {
  if (n === 0) return null;
  const titulo = ["", "Só telefone", "Telefone + email ou website", "Telefone + email + website"][n];
  return (
    <span className="inline-flex items-center gap-0.5" title={titulo} aria-label={`${n} de 3 estrelas`}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

export default function Home() {
  const [bairros, setBairros] = useState("");
  const [cidade, setCidade] = useState("");
  const [progresso, setProgresso] = useState("");
  const [vendedores, setVendedores] = useState(1);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [exportando, setExportando] = useState<"xlsx" | "csv" | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [buscou, setBuscou] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTelefone, setFiltroTelefone] = useState<FiltroTelefone>("todos");

  const tipos = useMemo(
    () => Array.from(new Set(leads.map((l) => l.tipo))).sort((a, b) => a.localeCompare(b)),
    [leads]
  );

  const filtrados = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();
    return leads.filter((l) => {
      if (filtroTipo && l.tipo !== filtroTipo) return false;
      if (filtroTelefone === "com" && !l.telefone) return false;
      if (filtroTelefone === "sem" && l.telefone) return false;
      if (filtroTelefone === "completos" && qualidadeLead(l) < 3) return false;
      if (!q) return true;
      return [l.nome, l.endereco, l.telefone, l.email, l.website, l.cnpj, l.razaoSocial, l.responsavel]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [leads, filtroTexto, filtroTipo, filtroTelefone]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const lista = Array.from(
      new Map(
        bairros
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
          .map((b) => [b.toLowerCase(), b] as const)
      ).values()
    );
    if (!lista.length || !cidade.trim()) return;
    setCarregando(true);
    setErro("");
    setAviso("");
    setLeads([]);
    setFiltroTexto("");
    setFiltroTipo("");
    setFiltroTelefone("todos");

    // Busca um bairro por vez para mostrar o progresso
    // e junta tudo, removendo duplicatas por nome + endereço
    const vistos = new Set<string>();
    const erros: string[] = [];
    const avisos: string[] = [];
    for (const [i, bairro] of lista.entries()) {
      setProgresso(`Buscando ${bairro}... ${i + 1}/${lista.length}`);
      try {
        const params = new URLSearchParams({ bairro, cidade });
        const res = await fetch(`/api/buscar?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro na busca");
        if (data.aviso) avisos.push(`${bairro}: ${data.aviso}`);
        if (data.leads.length === 0) avisos.push(`${bairro}: nenhuma empresa encontrada.`);
        const novos = (data.leads as Lead[]).filter((l) => {
          const chave = `${l.nome.toLowerCase()}|${l.endereco.toLowerCase()}`;
          if (vistos.has(chave)) return false;
          vistos.add(chave);
          return true;
        });
        setLeads((atuais) => [...atuais, ...novos]);
      } catch (err) {
        erros.push(`${bairro}: ${err instanceof Error ? err.message : "Erro na busca"}`);
      }
    }

    setErro(erros.join("\n"));
    setAviso(avisos.join("\n"));
    setProgresso("");
    setCarregando(false);
    setBuscou(true);
  }

  async function exportar(formato: "xlsx" | "csv") {
    setExportando(formato);
    setErro("");
    try {
      const res = await fetch("/api/exportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: filtrados, formato, vendedores }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro ao exportar");
      const blob = await res.blob();
      const nome =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `leads.${formato}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao exportar");
    } finally {
      setExportando(null);
    }
  }

  const input =
    "w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            ACC Telecom <span className="text-blue-400">— Gerador de Leads</span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Busque empresas ativas por bairro na base de CNPJs da Casa dos Dados.
          </p>
        </header>

        <form
          onSubmit={buscar}
          className="mb-6 grid gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
        >
          <textarea
            className={`${input} resize-y`}
            rows={3}
            placeholder={"Bairros, um por linha\nSantana\nVila Guilherme"}
            value={bairros}
            onChange={(e) => setBairros(e.target.value)}
            required
          />
          <input
            className={input}
            placeholder="Cidade (ex.: São Paulo)"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={carregando}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-60"
          >
            {carregando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {carregando ? "Buscando..." : "Buscar"}
          </button>
        </form>

        {progresso && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {progresso}
          </div>
        )}
        {erro && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm whitespace-pre-line text-red-300">
            {erro}
          </div>
        )}
        {aviso && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm whitespace-pre-line text-amber-300">
            {aviso}
          </div>
        )}

        {leads.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                className={`${input} pl-9`}
                placeholder="Filtrar por nome, endereço, telefone..."
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
              />
            </div>
            <div className="relative">
              <Funnel className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <select
                className={`${input} pl-9 capitalize`}
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {tipos.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-sm text-gray-400">
              {filtrados.length} de {leads.length} leads
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-400" title="Só vale para o Excel">
                <Users className="h-4 w-4 text-gray-500" />
                Dividir entre
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={vendedores}
                  onChange={(e) => setVendedores(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))}
                  className={`${input} w-16 px-2 py-2 text-center`}
                />
                vendedores
              </label>
              <button
                onClick={() => exportar("xlsx")}
                disabled={!filtrados.length || exportando !== null}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                {exportando === "xlsx" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Excel
              </button>
              <button
                onClick={() => exportar("csv")}
                disabled={!filtrados.length || exportando !== null}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
              >
                {exportando === "csv" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                CSV
              </button>
            </div>
            <div className="flex w-full flex-wrap gap-2">
              {OPCOES_TELEFONE.map(([valor, label]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setFiltroTelefone(valor)}
                  aria-pressed={filtroTelefone === valor}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
                    filtroTelefone === valor
                      ? "bg-blue-600 text-white ring-blue-600"
                      : "bg-gray-900 text-gray-300 ring-gray-700 hover:bg-gray-800"
                  }`}
                >
                  {valor !== "todos" && <Phone className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {buscou && !carregando && !erro && leads.length === 0 && (
          <p className="py-16 text-center text-gray-500">
            Nenhuma empresa encontrada. Confira a grafia do bairro e da cidade.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((l) => (
            <article
              key={l.id}
              className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4 transition-colors hover:border-gray-700"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold" title={l.nome}>
                    {l.nome}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300 capitalize">
                      <Building className="h-3 w-3" />
                      {l.tipo}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                      <MapPinned className="h-3 w-3" />
                      {l.bairroBuscado}
                    </span>
                    <Estrelas n={qualidadeLead(l)} />
                  </div>
                </div>
                {l.situacao && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ${corSituacao(
                      l.situacao
                    )}`}
                  >
                    {l.situacao.toLowerCase()}
                  </span>
                )}
              </div>

              <ul className="space-y-1.5 text-sm text-gray-300">
                {l.endereco && (
                  <li className="flex gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    {l.endereco}
                  </li>
                )}
                {l.telefone && (
                  <li className="flex gap-2">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    <a href={`tel:${l.telefone}`} className="hover:text-blue-400">
                      {l.telefone}
                    </a>
                  </li>
                )}
                {l.email && (
                  <li className="flex gap-2">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    <a href={`mailto:${l.email}`} className="truncate hover:text-blue-400">
                      {l.email}
                    </a>
                  </li>
                )}
                {l.website && (
                  <li className="flex gap-2">
                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    <a
                      href={l.website.startsWith("http") ? l.website : `https://${l.website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-blue-400"
                    >
                      {l.website.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                )}
              </ul>

              {(l.cnpj || l.responsavel) && (
                <ul className="space-y-1.5 border-t border-gray-800 pt-3 text-sm text-gray-400">
                  {l.cnpj && (
                    <li className="flex gap-2">
                      <Hash className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                      <span>
                        {formatarCnpj(l.cnpj)}
                        {l.razaoSocial && <span className="block text-xs text-gray-500">{l.razaoSocial}</span>}
                        {l.fantasia && <span className="block text-xs text-gray-500">{l.fantasia}</span>}
                      </span>
                    </li>
                  )}
                  {l.responsavel && (
                    <li className="flex gap-2">
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                      {l.responsavel}
                    </li>
                  )}
                  {l.dataAbertura && (
                    <li className="flex gap-2">
                      <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                      Aberta em {formatarData(l.dataAbertura)}
                    </li>
                  )}
                </ul>
              )}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
