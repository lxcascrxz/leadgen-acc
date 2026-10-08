import type { Lead } from "@/lib/types";

const PESQUISA_URL = "https://api.casadosdados.com.br/v5/cnpj/pesquisa?tipo_resultado=completo";
const LIMITE_PADRAO = 100;
const LIMITE_MIN = 10;
// Acima de 1000 a API volta silenciosamente para 10 resultados
const LIMITE_MAX = 1000;
const TIMEOUT_MS = 30_000;

type CasaDosDadosEmpresa = {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao_cadastral?: { situacao_atual?: string };
  data_abertura?: string;
  atividade_principal?: { descricao?: string };
  endereco?: {
    tipo_logradouro?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  };
  quadro_societario?: { nome?: string }[];
  contato_telefonico?: { completo?: string; ddd?: string; numero?: string }[];
  contato_email?: { email?: string; valido?: boolean }[];
};

// A Casa dos Dados não encontra nada com acento ("São Paulo" → 0 resultados, "sao paulo" → ok)
function semAcento(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// "RUA CARLOS ESCOBAR" → "Rua Carlos Escobar"
function capitalizar(s = "") {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

// "2011-07-14T00:00:00Z" → "14/07/2011"
function formatarData(iso?: string) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m && m[1] !== "0001" ? `${m[3]}/${m[2]}/${m[1]}` : undefined;
}

function formatarTelefone(t?: { completo?: string; ddd?: string; numero?: string }) {
  if (!t) return "";
  if (t.ddd && t.numero) return `(${t.ddd}) ${t.numero}`;
  return t.completo ?? "";
}

function toLead(e: CasaDosDadosEmpresa, bairroBuscado: string, dataBusca: string): Lead {
  const end = e.endereco ?? {};
  const rua = [end.tipo_logradouro, end.logradouro].filter(Boolean).join(" ");
  const endereco = [
    [capitalizar(rua), end.numero].filter(Boolean).join(", "),
    capitalizar(end.bairro),
    [capitalizar(end.municipio), end.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" - ");
  const email = e.contato_email?.find((c) => c.valido !== false)?.email ?? e.contato_email?.[0]?.email ?? "";
  const razaoSocial = e.razao_social ?? "";

  return {
    id: e.cnpj,
    nome: e.nome_fantasia?.trim() || razaoSocial,
    tipo: e.atividade_principal?.descricao ?? "",
    endereco,
    telefone: formatarTelefone(e.contato_telefonico?.[0]),
    email: email.toLowerCase(),
    website: "",
    // A Casa dos Dados só traz o centro do município, que não serve para localizar a empresa
    lat: 0,
    lng: 0,
    bairroBuscado,
    dataBusca,
    cnpj: e.cnpj,
    razaoSocial,
    situacao: e.situacao_cadastral?.situacao_atual,
    dataAbertura: formatarData(e.data_abertura),
    responsavel: e.quadro_societario?.[0]?.nome,
    bairroCnpj: capitalizar(end.bairro),
    fonte: "Casa dos Dados",
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bairro = searchParams.get("bairro")?.trim() ?? "";
  const cidade = searchParams.get("cidade")?.trim() ?? "";
  // Cada empresa retornada consome 1 crédito da Casa dos Dados
  const limite = Math.min(
    Math.max(Math.floor(Number(searchParams.get("limite")) || LIMITE_PADRAO), LIMITE_MIN),
    LIMITE_MAX
  );
  // A Casa dos Dados pagina em blocos do tamanho do limite: página 2 com limite 100 = empresas 101–200.
  // A ordem é estável, então continuar com o mesmo limite não repete nem pula empresas.
  const pagina = Math.max(parseInt(searchParams.get("pagina") || "1", 10) || 1, 1);

  if (!bairro || !cidade) {
    return Response.json({ error: "Informe bairro e cidade." }, { status: 400 });
  }
  // Local: .env.local · Vercel: Settings → Environment Variables (ver README)
  const apiKey = process.env.CASA_DOS_DADOS_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "CASA_DOS_DADOS_KEY não configurada. Localmente, crie o .env.local; na Vercel, adicione em Settings → Environment Variables e faça um novo deploy.",
      },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(PESQUISA_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        bairro: [semAcento(bairro)],
        municipio: [semAcento(cidade)],
        situacao_cadastral: ["ATIVA"],
        limite,
        pagina,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401) {
      return Response.json({ error: "Chave da Casa dos Dados inválida." }, { status: 502 });
    }
    if (res.status === 403) {
      // A API recusa a busca inteira quando o limite pedido passa do saldo, em vez de trazer só o que cabe
      return Response.json(
        {
          error: `Saldo de créditos da Casa dos Dados insuficiente para trazer até ${limite} empresas. Diminua o "Máx. por bairro" ou recarregue os créditos.`,
        },
        { status: 402 }
      );
    }
    if (!res.ok) {
      return Response.json({ error: `Casa dos Dados respondeu ${res.status}.` }, { status: 502 });
    }

    const data = (await res.json()) as { total?: number; cnpjs?: CasaDosDadosEmpresa[] };
    const dataBusca = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const leads = (data.cnpjs ?? []).map((e) => toLead(e, bairro, dataBusca));
    const totalEncontrados = data.total ?? leads.length;

    return Response.json({ total: leads.length, totalEncontrados, paginaAtual: pagina, leads });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return Response.json({ error: `Falha ao consultar a Casa dos Dados: ${msg}` }, { status: 502 });
  }
}
