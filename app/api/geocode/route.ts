// Proxy para o Nominatim: o navegador não deixa definir User-Agent, que a política do Nominatim exige.
// O ritmo de 1 requisição por segundo é controlado no cliente (lib/nominatim.ts).
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "leadgen-acc/1.0";

export type ResultadoNominatim = {
  lat: string;
  lon: string;
  class: string;
  type: string;
  geojson?: GeoJSON.Geometry;
  // Município do resultado, para descartar homônimos de outras cidades
  cidade?: string;
};

type Endereco = { city?: string; town?: string; village?: string; municipality?: string };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const poligono = searchParams.get("poligono") === "1";

  if (!q || q.length > 300) {
    return Response.json({ error: "Parâmetro q inválido." }, { status: 400 });
  }

  const params = new URLSearchParams({
    q,
    format: "json",
    countrycodes: "br",
    addressdetails: "1",
    limit: poligono ? "5" : "3",
  });
  if (poligono) {
    params.set("polygon_geojson", "1");
    // Simplifica o contorno para caber no histórico do localStorage (~1 KB por bairro)
    params.set("polygon_threshold", "0.0005");
  }

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return Response.json({ error: `Nominatim respondeu ${res.status}.` }, { status: res.status });
    }
    const dados = (await res.json()) as (ResultadoNominatim & { address?: Endereco })[];
    return Response.json(
      dados.map(({ lat, lon, class: classe, type, geojson, address: a }) => ({
        lat,
        lon,
        class: classe,
        type,
        geojson,
        cidade: a?.city ?? a?.town ?? a?.village ?? a?.municipality,
      }))
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return Response.json({ error: `Falha ao consultar o Nominatim: ${msg}` }, { status: 502 });
  }
}
