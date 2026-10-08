import type { Lead } from "@/lib/types";

export const maxDuration = 60;

// Servidores públicos tentados em ordem; o principal costuma ficar sobrecarregado
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const CNPJ_URL = "https://receitaws.com.br/v1/cnpj";
const CNPJ_TIMEOUT_MS = 4_000;
const USER_AGENT = "ACC-Telecom-LeadGen/0.1";
const MAX_RESULTS = 100;
const MAX_ENRICH = 20;

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const TIPO_KEYS = ["shop", "amenity", "office", "craft", "tourism", "healthcare", "leisure"];

// Busca por nome exato usa o índice da Overpass; regex case-insensitive estoura o timeout
function escapeTag(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

// "são paulo" -> "São Paulo", "vila DA saude" -> "Vila da Saude"
function normalizarNome(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

async function overpass(query: string): Promise<OsmElement[]> {
  let ultimoErro = "";
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          // A Overpass recusa (406) requisições sem um User-Agent identificável
          "User-Agent": USER_AGENT,
        },
        body: "data=" + encodeURIComponent(query),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        ultimoErro = `${new URL(url).host} respondeu ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      if (json.remark?.includes("error")) {
        ultimoErro = `${new URL(url).host}: ${json.remark}`;
        continue;
      }
      return json.elements ?? [];
    } catch (e) {
      ultimoErro = `${new URL(url).host}: ${e instanceof Error ? e.message : e}`;
    }
  }
  throw new Error(ultimoErro || "nenhum servidor Overpass disponível");
}

const filtrosEmpresa = (area: string) =>
  TIPO_KEYS.map((k) => `nwr${area}["name"]["${k}"];`).join("\n");

function queryPorArea(bairro: string, cidade: string) {
  const b = escapeTag(bairro);
  const c = escapeTag(cidade);
  return `[out:json][timeout:25];
area["boundary"="administrative"]["name"="${c}"]->.cidade;
(
  area(area.cidade)["name"="${b}"]["boundary"="administrative"];
  area(area.cidade)["name"="${b}"]["place"];
)->.bairro;
(
${filtrosEmpresa("(area.bairro)")}
);
out center tags ${MAX_RESULTS};`;
}

// Muitos bairros no OSM são apenas um ponto (place=suburb/neighbourhood): busca num raio ao redor
function queryPorRaio(bairro: string, cidade: string, raio = 1200) {
  const b = escapeTag(bairro);
  const c = escapeTag(cidade);
  return `[out:json][timeout:25];
area["boundary"="administrative"]["name"="${c}"]->.cidade;
node(area.cidade)["place"~"suburb|neighbourhood|quarter|village"]["name"="${b}"]->.centro;
(
${filtrosEmpresa(`(around.centro:${raio})`)}
);
out center tags ${MAX_RESULTS};`;
}

function montarEndereco(t: Record<string, string>) {
  if (t["addr:full"]) return t["addr:full"];
  const rua = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  return [rua, t["addr:suburb"], t["addr:city"], t["addr:postcode"]].filter(Boolean).join(" - ");
}

function apenasDigitos(s?: string) {
  return (s ?? "").replace(/\D/g, "");
}

function toLead(el: OsmElement, bairroBuscado: string, dataBusca: string): Lead {
  const t = el.tags ?? {};
  const tipoKey = TIPO_KEYS.find((k) => t[k]);
  const cnpj = apenasDigitos(t["ref:vatin"] || t["ref:CNPJ"] || t["cnpj"] || t["ref:cnpj"]);
  return {
    id: `${el.type}/${el.id}`,
    nome: t.name,
    bairroBuscado,
    dataBusca,
    tipo: tipoKey ? t[tipoKey].replace(/_/g, " ") : "outro",
    endereco: montarEndereco(t),
    telefone: t.phone || t["contact:phone"] || t["contact:mobile"] || t["contact:whatsapp"] || "",
    email: t.email || t["contact:email"] || "",
    website: t.website || t["contact:website"] || t.url || "",
    lat: el.lat ?? el.center?.lat ?? null,
    lng: el.lon ?? el.center?.lon ?? null,
    ...(cnpj.length === 14 ? { cnpj } : {}),
  };
}

type ReceitaWsResponse = {
  status?: string;
  nome?: string;
  fantasia?: string;
  situacao?: string;
  abertura?: string;
  telefone?: string;
  email?: string;
  qsa?: { nome?: string }[];
};

// A ReceitaWS não tem busca por nome (/v1/company/search responde 404), só consulta por CNPJ
async function enriquecer(lead: Lead): Promise<Lead | "rate-limit"> {
  if (!lead.cnpj) return lead;
  const res = await fetch(`${CNPJ_URL}/${lead.cnpj}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(CNPJ_TIMEOUT_MS),
  });
  if (res.status === 429) return "rate-limit";
  if (!res.ok) return lead;
  const d = (await res.json()) as ReceitaWsResponse;
  if (d.status === "ERROR") return lead;
  return {
    ...lead,
    razaoSocial: d.nome,
    fantasia: d.fantasia || undefined,
    situacao: d.situacao,
    dataAbertura: d.abertura,
    responsavel: d.qsa?.[0]?.nome,
    email: lead.email || d.email?.toLowerCase() || "",
    // A ReceitaWS pode trazer mais de um telefone separados por "/"
    telefone: lead.telefone || d.telefone?.split("/")[0].trim() || "",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bairro = normalizarNome(searchParams.get("bairro") ?? "");
  const cidade = normalizarNome(searchParams.get("cidade") ?? "");
  const enrich = searchParams.get("enriquecer") === "true";

  if (!bairro || !cidade) {
    return Response.json({ error: "Informe bairro e cidade." }, { status: 400 });
  }

  try {
    const dataBusca = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    let elementos = await overpass(queryPorArea(bairro, cidade));
    if (elementos.length === 0) elementos = await overpass(queryPorRaio(bairro, cidade));

    const vistos = new Set<string>();
    let leads = elementos
      .filter((el) => el.tags?.name)
      .map((el) => toLead(el, bairro, dataBusca))
      .filter((l) => {
        const chave = l.nome.toLowerCase() + "|" + l.endereco.toLowerCase();
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      })
      .slice(0, MAX_RESULTS);

    let avisoEnriquecimento: string | undefined;
    if (enrich) {
      const comCnpj = leads.filter((l) => l.cnpj);
      let enriquecidos = 0;
      // A API pública da ReceitaWS tem limite baixo de requisições: consulta em série e para no 429
      for (const lead of comCnpj.slice(0, MAX_ENRICH)) {
        const r = await enriquecer(lead).catch(() => lead);
        if (r === "rate-limit") {
          avisoEnriquecimento = "Limite da API ReceitaWS atingido; parte dos leads não foi enriquecida.";
          break;
        }
        leads = leads.map((l) => (l.id === r.id ? r : l));
        enriquecidos++;
      }
      if (!avisoEnriquecimento) {
        avisoEnriquecimento =
          comCnpj.length === 0
            ? "Nenhum resultado possui CNPJ cadastrado no OpenStreetMap para enriquecer."
            : `${enriquecidos} de ${comCnpj.length} leads com CNPJ enriquecidos.`;
      }
    }

    return Response.json({ total: leads.length, leads, aviso: avisoEnriquecimento });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return Response.json({ error: `Falha ao consultar o OpenStreetMap: ${msg}` }, { status: 502 });
  }
}
