import type { ResultadoNominatim } from "@/app/api/geocode/route";

export type Coordenada = { lat: number; lng: number; aproximado?: boolean };

export type GeoBairro =
  | { tipo: "poligono"; geojson: GeoJSON.Geometry }
  // Sem polígono: ponto do bairro ou, em último caso, centro do município
  | { tipo: "ponto"; lat: number; lng: number; centroMunicipio?: boolean };

export class NominatimRateLimit extends Error {}

// Política do Nominatim: no máximo 1 requisição por segundo. Todas as chamadas passam por esta fila.
const INTERVALO_MS = 1_100;
let fila: Promise<unknown> = Promise.resolve();
let ultimaChamada = 0;

function agendar<T>(fn: () => Promise<T>): Promise<T> {
  const tarefa = fila.then(async () => {
    const espera = ultimaChamada + INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamada = Date.now();
    return fn();
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}

async function buscar(q: string, poligono = false): Promise<ResultadoNominatim[]> {
  return agendar(async () => {
    const params = new URLSearchParams({ q, ...(poligono ? { poligono: "1" } : {}) });
    const res = await fetch(`/api/geocode?${params}`);
    if (res.status === 429) throw new NominatimRateLimit("Limite do Nominatim atingido.");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Erro ${res.status}`);
    return res.json();
  });
}

// Cache de endereços já geocodificados (inclusive os não encontrados) para não repetir consultas
const CACHE_KEY = "leadgen:geocache";
const CACHE_MAX = 3_000;
type Cache = Record<string, Coordenada | 0>;

function lerCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function gravarCache(endereco: string, valor: Coordenada | 0) {
  try {
    const cache = lerCache();
    cache[endereco] = valor;
    const chaves = Object.keys(cache);
    for (const k of chaves.slice(0, Math.max(0, chaves.length - CACHE_MAX))) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage cheio ou indisponível: segue sem cache
  }
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// "Rua X, 230 - Santana - Sao Paulo/SP" → partes para montar as consultas
function partesEndereco(endereco: string) {
  const partes = endereco.split(" - ");
  const [cidade = "", uf = ""] = (partes.at(-1) ?? "").split("/");
  const ruaNumero = partes[0] ?? "";
  return { ruaNumero, rua: ruaNumero.replace(/,\s*[^,]*$/, ""), bairro: partes.length > 2 ? partes[1] : "", cidade, uf };
}

export async function geocodificarEndereco(endereco: string): Promise<Coordenada | null> {
  if (!endereco) return null;
  const emCache = lerCache()[endereco];
  if (emCache !== undefined) return emCache || null;

  const { ruaNumero, rua, bairro, cidade, uf } = partesEndereco(endereco);
  // O Nominatim às vezes devolve rua homônima de outra cidade (ex.: Guarulhos para um endereço de SP)
  const mesmaCidade = (r: ResultadoNominatim) => !cidade || !r.cidade || normalizar(r.cidade) === normalizar(cidade);

  const completo = [ruaNumero, bairro, cidade, uf, "Brasil"].filter(Boolean).join(", ");
  let r = (await buscar(completo)).find(mesmaCidade);
  let aproximado = false;
  // Número ou bairro às vezes não batem com o OSM: tenta só rua + cidade (pin no meio da rua)
  if (!r && rua && rua !== ruaNumero) {
    r = (await buscar([rua, cidade, uf, "Brasil"].filter(Boolean).join(", "))).find(mesmaCidade);
    aproximado = Boolean(r);
  }

  const coord = r ? { lat: Number(r.lat), lng: Number(r.lon), ...(aproximado ? { aproximado } : {}) } : null;
  gravarCache(endereco, coord ?? 0);
  return coord;
}

const temPoligono = (r: ResultadoNominatim) =>
  r.geojson?.type === "Polygon" || r.geojson?.type === "MultiPolygon";

export async function localizarBairro(bairro: string, cidade: string): Promise<GeoBairro | null> {
  const resultados = await buscar(`${bairro}, ${cidade}, Brasil`, true);
  // Prefere limites administrativos/lugares; evita pegar, por ex., a estação de metrô de mesmo nome
  const relevantes = resultados.filter((r) => r.class === "boundary" || r.class === "place");
  const comPoligono = relevantes.find(temPoligono);
  if (comPoligono?.geojson) return { tipo: "poligono", geojson: comPoligono.geojson };

  const ponto = relevantes[0] ?? resultados[0];
  if (ponto) return { tipo: "ponto", lat: Number(ponto.lat), lng: Number(ponto.lon) };

  const [municipio] = await buscar(`${cidade}, Brasil`);
  if (municipio) {
    return { tipo: "ponto", lat: Number(municipio.lat), lng: Number(municipio.lon), centroMunicipio: true };
  }
  return null;
}
