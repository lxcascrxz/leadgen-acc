"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  Building,
  Calendar,
  Clock,
  FileSpreadsheet,
  FileText,
  Funnel,
  Globe,
  Hash,
  LayoutGrid,
  LoaderCircle,
  Mail,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Star,
  User,
  Users,
  X,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { qualidadeLead } from "@/lib/qualidade";
import {
  COR_FAIXA,
  chaveBairro,
  faixaIdade,
  assinarHistorico,
  atualizarHistorico,
  historicoAtual,
  historicoServidor,
  hojeISO,
  idadeDias,
  registrarBusca,
  rotuloIdade,
  type EntradaHistorico,
  type FaixaIdade,
} from "@/lib/historico";
import { geocodificarEndereco, localizarBairro, NominatimRateLimit, type Coordenada } from "@/lib/nominatim";
import type { Cobertura, Pin } from "@/components/MapComponent";

// Leaflet acessa window: só pode ser carregado no navegador
const MapComponent = dynamic(() => import("@/components/MapComponent"), {
  ssr: false,
  loading: () => <div className="h-[600px] animate-pulse rounded-xl bg-gray-900" />,
});

const CLASSE_FAIXA: Record<FaixaIdade, string> = {
  recente: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25",
  medio: "bg-amber-500/15 text-amber-300 ring-amber-500/30 hover:bg-amber-500/25",
  antigo: "bg-gray-500/15 text-gray-400 ring-gray-500/30 hover:bg-gray-500/25",
};

// Pins: roxo = ⭐⭐⭐, azul = ⭐⭐, cinza = ⭐ ou sem estrela
const COR_PIN = ["#6b7280", "#6b7280", "#2563eb", "#9333ea"];

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

const LIMITE_PADRAO = 100;
const LIMITE_MIN = 10;
const LIMITE_MAX = 1000;

function ajustarLimite(v: string) {
  return Math.min(Math.max(Math.round(Number(v)) || LIMITE_PADRAO, LIMITE_MIN), LIMITE_MAX);
}

type InfoBairro = {
  bairro: string;
  cidade: string;
  limite: number; // limite da 1ª página, mantido nas seguintes
  carregados: number; // leads novos (sem duplicatas) somados de todas as páginas
};

const chaveLead = (l: Lead) => `${l.nome.toLowerCase()}|${l.endereco.toLowerCase()}`;

const formatarNumero = (n: number) => n.toLocaleString("pt-BR");

function truncar(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function Estrelas({ n }: { n: number }) {
  if (n === 0) return null;
  const titulo = ["", "Só telefone", "Telefone + email ou responsável", "Telefone + email + responsável"][n];
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
  // Texto livre enquanto digita; vira número dentro da faixa no blur e na busca
  const [limite, setLimite] = useState(String(LIMITE_PADRAO));
  const [leads, setLeads] = useState<Lead[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [exportando, setExportando] = useState<"xlsx" | "csv" | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [buscou, setBuscou] = useState(false);
  // Por bairro (chave bairro|cidade): última página carregada e total de empresas na base
  const [paginaAtual, setPaginaAtual] = useState<Record<string, number>>({});
  const [totalEncontrados, setTotalEncontrados] = useState<Record<string, number>>({});
  const [infoBairro, setInfoBairro] = useState<Record<string, InfoBairro>>({});
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTelefone, setFiltroTelefone] = useState<FiltroTelefone>("todos");
  const [aba, setAba] = useState<"leads" | "mapa">("leads");
  // Histórico vive no localStorage; no servidor (prerender) começa vazio
  const historico = useSyncExternalStore(assinarHistorico, historicoAtual, historicoServidor);
  const bairrosLocalizando = useRef(new Set<string>());
  // Coordenadas por id do lead; null = endereço não encontrado
  const [coords, setCoords] = useState<Record<string, Coordenada | null>>({});
  const [geoProgresso, setGeoProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [geoAviso, setGeoAviso] = useState("");
  const [enquadrarEm, setEnquadrarEm] = useState(0);
  // Incrementado a cada nova busca para interromper uma geocodificação em andamento
  const geoExecucao = useRef(0);

  // Busca no Nominatim o contorno de cada bairro do histórico que ainda não tem (em segundo plano)
  useEffect(() => {
    for (const entrada of historico) {
      const chave = chaveBairro(entrada);
      if (entrada.geo !== undefined || bairrosLocalizando.current.has(chave)) continue;
      bairrosLocalizando.current.add(chave);
      localizarBairro(entrada.bairro, entrada.cidade)
        .then((geo) =>
          atualizarHistorico((lista) => lista.map((e) => (chaveBairro(e) === chave ? { ...e, geo } : e)))
        )
        .catch(() => {
          // Falha temporária (rede/limite): libera para tentar de novo na próxima mudança do histórico
        })
        .finally(() => bairrosLocalizando.current.delete(chave));
    }
  }, [historico]);

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

  // Busca cada bairro em sequência. Bairro novo começa na página 1; bairro já buscado nesta sessão
  // continua da próxima página com o mesmo limite, e os leads são somados aos que já estão na tela.
  async function buscarBairros(alvos: { bairro: string; cidade: string }[], limiteNovo: number) {
    setCarregando(true);
    setErro("");
    setAviso("");

    // Duplicatas: mesmo CNPJ ou mesmo nome + endereço
    const vistos = new Set(leads.flatMap((l) => [l.id, chaveLead(l)]));
    const erros: string[] = [];
    const avisos: string[] = [];
    for (const [i, { bairro, cidade }] of alvos.entries()) {
      const chave = chaveBairro({ bairro, cidade });
      const anterior = infoBairro[chave];
      const pagina = (paginaAtual[chave] ?? 0) + 1;
      // Mudar o limite no meio desalinharia as páginas (pularia ou repetiria empresas)
      const limiteBairro = anterior?.limite ?? limiteNovo;
      const total = totalEncontrados[chave];
      if (total !== undefined && (pagina - 1) * limiteBairro >= total) {
        avisos.push(`${bairro}: todas as ${formatarNumero(total)} empresas da base já foram carregadas.`);
        continue;
      }

      setProgresso(`Buscando ${bairro} (página ${pagina})... ${i + 1}/${alvos.length}`);
      try {
        const params = new URLSearchParams({
          bairro,
          cidade,
          limite: String(limiteBairro),
          pagina: String(pagina),
        });
        const res = await fetch(`/api/buscar?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro na busca");
        if (data.leads.length === 0 && pagina === 1) avisos.push(`${bairro}: nenhuma empresa encontrada.`);

        const novos = (data.leads as Lead[]).filter((l) => {
          if (vistos.has(l.id) || vistos.has(chaveLead(l))) return false;
          vistos.add(l.id);
          vistos.add(chaveLead(l));
          return true;
        });
        const carregados = (anterior?.carregados ?? 0) + novos.length;
        setLeads((atuais) => [...atuais, ...novos]);
        setPaginaAtual((p) => ({ ...p, [chave]: data.paginaAtual }));
        setTotalEncontrados((t) => ({ ...t, [chave]: data.totalEncontrados }));
        setInfoBairro((info) => ({ ...info, [chave]: { bairro, cidade, limite: limiteBairro, carregados } }));
        if (carregados > 0) {
          const entrada = { bairro, cidade, data: hojeISO(), total: carregados };
          atualizarHistorico((lista) => registrarBusca(lista, entrada));
        }
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

  function buscar(e: React.FormEvent) {
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
    const limiteValido = ajustarLimite(limite);
    setLimite(String(limiteValido));
    buscarBairros(
      lista.map((bairro) => ({ bairro, cidade: cidade.trim() })),
      limiteValido
    );
  }

  // Próxima página de todos os bairros que ainda têm empresas na base
  function carregarMais() {
    buscarBairros(
      bairrosComMais.map(({ bairro, cidade }) => ({ bairro, cidade })),
      ajustarLimite(limite)
    );
  }

  function limparResultados() {
    geoExecucao.current++;
    setLeads([]);
    setPaginaAtual({});
    setTotalEncontrados({});
    setInfoBairro({});
    setCoords({});
    setGeoProgresso(null);
    setGeoAviso("");
    setErro("");
    setAviso("");
    setFiltroTexto("");
    setFiltroTipo("");
    setFiltroTelefone("todos");
    setBuscou(false);
  }

  // Geocodifica um endereço por vez (a fila em lib/nominatim garante 1 req/s); endereços em cache são instantâneos
  async function mostrarNoMapa() {
    const execucao = ++geoExecucao.current;
    setAba("mapa");
    setGeoAviso("");
    const pendentes = leads.filter((l) => !(l.id in coords));
    setGeoProgresso({ feitos: 0, total: pendentes.length });
    for (const [i, lead] of pendentes.entries()) {
      try {
        const c = await geocodificarEndereco(lead.endereco);
        if (geoExecucao.current !== execucao) return;
        setCoords((atual) => ({ ...atual, [lead.id]: c }));
      } catch (err) {
        if (geoExecucao.current !== execucao) return;
        if (err instanceof NominatimRateLimit) {
          setGeoAviso("O Nominatim limitou as consultas. Tente continuar em alguns minutos.");
          break;
        }
        setCoords((atual) => ({ ...atual, [lead.id]: null }));
      }
      setGeoProgresso({ feitos: i + 1, total: pendentes.length });
    }
    if (geoExecucao.current !== execucao) return;
    setGeoProgresso(null);
    setEnquadrarEm(Date.now());
  }

  function usarBairroDoHistorico(e: EntradaHistorico) {
    const linhas = bairros
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
    if (!linhas.some((b) => b.toLowerCase() === e.bairro.toLowerCase())) {
      setBairros([...linhas, e.bairro].join("\n"));
    }
    setCidade(e.cidade);
  }

  function removerDoHistorico(e: EntradaHistorico) {
    const chave = chaveBairro(e);
    atualizarHistorico((lista) => lista.filter((x) => chaveBairro(x) !== chave));
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

  const coberturas = useMemo<Cobertura[]>(
    () =>
      historico.flatMap((e) =>
        e.geo
          ? [
              {
                id: chaveBairro(e),
                rotulo: `${e.bairro} · ${e.total} leads · ${rotuloIdade(idadeDias(e.data))}`,
                cor: COR_FAIXA[faixaIdade(idadeDias(e.data))],
                geo: e.geo,
              },
            ]
          : []
      ),
    [historico]
  );

  // Respeita os filtros da aba Leads
  const pins = useMemo<Pin[]>(
    () =>
      filtrados.flatMap((l) => {
        const c = coords[l.id];
        if (!c) return [];
        return [
          {
            id: l.id,
            lat: c.lat,
            lng: c.lng,
            aproximado: c.aproximado,
            cor: COR_PIN[qualidadeLead(l)],
            nome: l.nome,
            telefone: l.telefone,
            email: l.email,
            responsavel: l.responsavel,
          },
        ];
      }),
    [filtrados, coords]
  );

  const resumoBairros = Object.entries(infoBairro).map(([chave, info]) => {
    const total = totalEncontrados[chave] ?? 0;
    const restante = Math.max(total - (paginaAtual[chave] ?? 0) * info.limite, 0);
    return { ...info, chave, total, restante };
  });
  const bairrosComMais = resumoBairros.filter((b) => b.restante > 0);
  // Cada empresa nova consome 1 crédito: a próxima página custa no máximo isto
  const creditosProximaPagina = bairrosComMais.reduce((s, b) => s + Math.min(b.limite, b.restante), 0);

  const geocodificados = Object.keys(coords).length;
  const naoEncontrados = Object.values(coords).filter((c) => c === null).length;

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
          className="mb-6 grid gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-start"
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
          <label className="flex flex-col gap-1 text-xs text-gray-400" title="Cada empresa nova consome 1 crédito da Casa dos Dados">
            Máx. por bairro
            <input
              type="number"
              min={LIMITE_MIN}
              max={LIMITE_MAX}
              step={10}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              onBlur={() => setLimite(String(ajustarLimite(limite)))}
              className={`${input} w-28`}
            />
          </label>
          <button
            type="submit"
            disabled={carregando}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-60"
          >
            {carregando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {carregando ? "Buscando..." : "Buscar"}
          </button>
        </form>

        {historico.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-gray-400 uppercase">
              <Clock className="h-3.5 w-3.5" />
              Bairros já buscados
            </h2>
            <div className="flex flex-wrap gap-2">
              {historico.map((e) => {
                const dias = idadeDias(e.data);
                return (
                  <span
                    key={chaveBairro(e)}
                    className={`inline-flex items-center rounded-full text-xs ring-1 transition-colors ${CLASSE_FAIXA[faixaIdade(dias)]}`}
                  >
                    <button
                      type="button"
                      onClick={() => usarBairroDoHistorico(e)}
                      title={`Adicionar ${e.bairro} (${e.cidade}) à busca`}
                      className="py-1 pl-3"
                    >
                      {e.bairro} · {e.total} leads · {rotuloIdade(dias)}
                    </button>
                    <button
                      type="button"
                      onClick={() => removerDoHistorico(e)}
                      aria-label={`Remover ${e.bairro} do histórico`}
                      className="ml-1 rounded-full p-1 pr-2 opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          </section>
        )}

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

        {resumoBairros.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm">
            <ul className="space-y-0.5 text-blue-200">
              {resumoBairros.map((b) => (
                <li key={b.chave}>
                  <span className="font-medium text-white">{b.bairro}</span>
                  {": "}
                  {formatarNumero(b.carregados)} carregados · {formatarNumero(b.total)} na base
                  {b.restante === 0 && b.total > 0 && <span className="text-emerald-300"> · completo</span>}
                </li>
              ))}
            </ul>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {bairrosComMais.length > 0 && (
                <button
                  type="button"
                  onClick={carregarMais}
                  disabled={carregando}
                  title="Busca a próxima página de cada bairro que ainda tem empresas na base"
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500 disabled:opacity-60"
                >
                  {carregando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Carregar mais
                  <span className="text-xs font-normal text-blue-200">
                    (até {formatarNumero(creditosProximaPagina)} créditos)
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={limparResultados}
                disabled={carregando}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 font-medium hover:bg-gray-700 disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar resultados
              </button>
            </div>
          </div>
        )}

        {(leads.length > 0 || historico.length > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-gray-800">
            {(
              [
                ["leads", "Leads", LayoutGrid],
                ["mapa", "Mapa", MapIcon],
              ] as const
            ).map(([valor, label, Icone]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                aria-pressed={aba === valor}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  aba === valor
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                <Icone className="h-4 w-4" />
                {label}
                {valor === "leads" && leads.length > 0 && (
                  <span className="rounded-full bg-gray-800 px-1.5 text-xs text-gray-300">{leads.length}</span>
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3 pb-2 text-sm">
              {geoProgresso ? (
                <span className="flex items-center gap-2 text-blue-300">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Geocodificando... {geoProgresso.feitos}/{geoProgresso.total}
                </span>
              ) : (
                leads.length > 0 &&
                !carregando &&
                geocodificados < leads.length && (
                  <button
                    type="button"
                    onClick={mostrarNoMapa}
                    className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 font-medium hover:bg-gray-700"
                  >
                    <MapPin className="h-4 w-4" />
                    {geocodificados > 0 ? "Continuar geocodificação" : "Mostrar no mapa"}
                  </button>
                )
              )}
            </div>
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
                className={`${input} pl-9`}
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {tipos.map((t) => (
                  <option key={t} value={t} title={t}>
                    {truncar(t, 40)}
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

        {aba === "mapa" && (
          <section className="space-y-3">
            {geoAviso && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                {geoAviso}
              </div>
            )}
            <MapComponent coberturas={coberturas} pins={pins} enquadrarEm={enquadrarEm} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-400">
              <span className="font-medium text-gray-300">Bairros:</span>
              {(["recente", "medio", "antigo"] as const).map((f) => (
                <span key={f} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ background: COR_FAIXA[f] }} />
                  {{ recente: "< 7 dias", medio: "7–30 dias", antigo: "> 30 dias" }[f]}
                </span>
              ))}
              <span className="ml-2 font-medium text-gray-300">Leads:</span>
              {(
                [
                  [3, "⭐⭐⭐"],
                  [2, "⭐⭐"],
                  [1, "⭐ / sem estrela"],
                ] as const
              ).map(([q, label]) => (
                <span key={q} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: COR_PIN[q] }} />
                  {label}
                </span>
              ))}
              {geocodificados > 0 && (
                <span className="ml-auto">
                  {pins.length} no mapa
                  {naoEncontrados > 0 && ` · ${naoEncontrados} endereços não encontrados`}
                </span>
              )}
            </div>
          </section>
        )}

        {aba === "leads" && buscou && !carregando && !erro && leads.length === 0 && (
          <p className="py-16 text-center text-gray-500">
            Nenhuma empresa encontrada. Confira a grafia do bairro e da cidade.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" hidden={aba !== "leads"}>
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
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300" title={l.tipo}>
                      <Building className="h-3 w-3 shrink-0" />
                      {truncar(l.tipo, 40)}
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
