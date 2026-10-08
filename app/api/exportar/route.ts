// xlsx-js-style: mesma API do SheetJS, mas grava estilos de célula (a versão gratuita do xlsx ignora o "fill")
import * as XLSX from "xlsx-js-style";
import type { Lead } from "@/lib/types";
import { qualidadeLead, rotuloQualidade } from "@/lib/qualidade";

const MAX_VENDEDORES = 20;

const COLUNAS: [string, (l: Lead, hoje: string) => string][] = [
  ["Nome", (l) => l.nome],
  ["Tipo", (l) => l.tipo],
  ["Endereço", (l) => l.endereco],
  ["Telefone", (l) => l.telefone],
  ["E-mail", (l) => l.email],
  ["Website", (l) => l.website],
  ["CNPJ", (l) => l.cnpj ?? ""],
  ["Razão Social", (l) => l.razaoSocial ?? ""],
  ["Situação", (l) => l.situacao ?? ""],
  ["Responsável", (l) => l.responsavel ?? ""],
  ["Bairro Buscado", (l) => l.bairroBuscado ?? ""],
  ["Qualidade", (l) => rotuloQualidade(qualidadeLead(l))],
  ["Status", () => ""], // preenchido à mão: Novo / Contatado / Sem interesse / Cliente
  ["Data da Busca", (l, hoje) => l.dataBusca || hoje],
];

const LARGURAS: Record<string, number> = {
  Nome: 32,
  Endereço: 40,
  "Razão Social": 32,
  Responsável: 28,
  Website: 28,
  "E-mail": 28,
};

const COR_TODOS = "374151"; // cinza
const CORES_VENDEDOR = ["2563EB", "16A34A", "EA580C", "7C3AED", "DB2777", "0891B2", "CA8A04", "DC2626"];

function montarAba(leads: Lead[], hoje: string, corCabecalho: string) {
  const linhas = [COLUNAS.map(([label]) => label), ...leads.map((l) => COLUNAS.map(([, fn]) => fn(l, hoje)))];
  const sheet = XLSX.utils.aoa_to_sheet(linhas);

  COLUNAS.forEach((_, c) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    cell.s = {
      fill: { patternType: "solid", fgColor: { rgb: corCabecalho } },
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { vertical: "center" },
    };
  });
  sheet["!cols"] = COLUNAS.map(([label]) => ({ wch: LARGURAS[label] ?? Math.max(label.length + 2, 14) }));
  if (leads.length) sheet["!autofilter"] = { ref: sheet["!ref"]! };
  return sheet;
}

// Ordena por qualidade e distribui em rodízio: cada vendedor recebe leads bons e ruins na mesma proporção
function dividirPorVendedor(leads: Lead[], n: number) {
  const ordenados = [...leads].sort((a, b) => qualidadeLead(b) - qualidadeLead(a));
  const grupos: Lead[][] = Array.from({ length: n }, () => []);
  ordenados.forEach((l, i) => grupos[i % n].push(l));
  return grupos;
}

export async function POST(request: Request) {
  let body: { leads?: Lead[]; formato?: string; vendedores?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (leads.length === 0) {
    return Response.json({ error: "Nenhum lead para exportar." }, { status: 400 });
  }
  const formato = body.formato === "csv" ? "csv" : "xlsx";
  const vendedores = Math.min(
    Math.max(Math.floor(Number(body.vendedores) || 1), 1),
    MAX_VENDEDORES,
    leads.length
  );

  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const dataArquivo = new Date().toISOString().slice(0, 10);
  const todos = montarAba(leads, hoje, COR_TODOS);

  if (formato === "csv") {
    // BOM para o Excel reconhecer acentos; ";" é o separador padrão no Excel em pt-BR
    const csv = "﻿" + XLSX.utils.sheet_to_csv(todos, { FS: ";" });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${dataArquivo}.csv"`,
      },
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, todos, "Todos os Leads");
  if (vendedores > 1) {
    dividirPorVendedor(leads, vendedores).forEach((grupo, i) => {
      const aba = montarAba(grupo, hoje, CORES_VENDEDOR[i % CORES_VENDEDOR.length]);
      XLSX.utils.book_append_sheet(wb, aba, `Vendedor ${i + 1}`);
    });
  }
  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads-${dataArquivo}.xlsx"`,
    },
  });
}
