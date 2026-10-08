export type Lead = {
  id: string;
  nome: string;
  tipo: string;
  endereco: string;
  telefone: string;
  email: string;
  website: string;
  lat: number | null;
  lng: number | null;
  bairroBuscado: string;
  dataBusca: string; // DD/MM/AAAA
  cnpj?: string;
  razaoSocial?: string;
  fantasia?: string;
  situacao?: string;
  dataAbertura?: string;
  responsavel?: string;
};
