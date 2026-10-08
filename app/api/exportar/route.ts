import * as XLSX from "xlsx";
import type { Lead } from "@/lib/types";

const COLUNAS: [keyof Lead, string][] = [
  ["nome", "Nome"],
  ["tipo", "Tipo"],
  ["endereco", "Endereço"],
  ["telefone", "Telefone"],
  ["email", "E-mail"],
  ["website", "Website"],
  ["cnpj", "CNPJ"],
  ["razaoSocial", "Razão Social"],
  ["situacao", "Situação"],
  ["responsavel", "Responsável"],
];

export async function POST(request: Request) {
  let body: { leads?: Lead[]; formato?: string };
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

  const linhas = leads.map((l) =>
    Object.fromEntries(COLUNAS.map(([k, label]) => [label, l[k] ?? ""]))
  );
  const sheet = XLSX.utils.json_to_sheet(linhas, { header: COLUNAS.map(([, label]) => label) });
  const data = new Date().toISOString().slice(0, 10);

  if (formato === "csv") {
    // BOM para o Excel reconhecer acentos; ";" é o separador padrão no Excel em pt-BR
    const csv = "﻿" + XLSX.utils.sheet_to_csv(sheet, { FS: ";" });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${data}.csv"`,
      },
    });
  }

  sheet["!cols"] = COLUNAS.map(([, label]) => ({ wch: Math.max(label.length + 2, 18) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Leads");
  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="leads-${data}.xlsx"`,
    },
  });
}
