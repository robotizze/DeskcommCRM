/** Contrato do módulo imobiliário; catálogo, contatos, equipe e agenda mantêm a fonte da verdade. */
export const FINALIDADES = ["venda", "locacao"] as const;
export const TIPOS_DE_IMOVEL = ["casa", "apartamento", "terreno", "comercial", "rural"] as const;
export const ETAPAS_DE_CAPTACAO = [
  "novo",
  "em_contato",
  "documentacao",
  "publicado",
  "encerrado",
] as const;
export const ESTADOS_DE_INTERESSE = [
  "aberto",
  "em_visita",
  "proposta",
  "concluido",
  "encerrado",
] as const;
export type Finalidade = (typeof FINALIDADES)[number];
export type TipoDeImovel = (typeof TIPOS_DE_IMOVEL)[number];
export type EtapaDeCaptacao = (typeof ETAPAS_DE_CAPTACAO)[number];
export type EstadoDeInteresse = (typeof ESTADOS_DE_INTERESSE)[number];

export interface Imovel {
  id: string;
  produto_id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  preco_cents: number;
  moeda: string;
  imagem_url: string | null;
  ativo: boolean;
  finalidade: Finalidade;
  tipo: TipoDeImovel;
  bairro: string;
  cidade: string;
  uf: string;
  quartos: number;
  banheiros: number;
  vagas: number;
  area_m2: number | null;
  endereco: string | null;
  proprietario_id: string | null;
  corretor_id: string | null;
  etapa_captacao: EtapaDeCaptacao;
  proximo_passo: string | null;
  proximo_contato_em: string | null;
  created_at: string;
  updated_at: string;
}
export interface Corretor {
  id: string;
  user_id: string;
  nome: string;
  creci: string;
  ativo: boolean;
  especialidades: string[];
  regioes: string[];
  created_at: string;
  updated_at: string;
}
export interface Interessado {
  id: string;
  contact_id: string;
  contato_nome: string;
  finalidade: Finalidade;
  tipo: TipoDeImovel | null;
  orcamento_min_cents: number;
  orcamento_max_cents: number;
  bairros: string[];
  quartos_min: number;
  prazo: string | null;
  corretor_id: string | null;
  status: EstadoDeInteresse;
  proximo_passo: string | null;
  proximo_contato_em: string | null;
  created_at: string;
  updated_at: string;
}
export interface Visita {
  id: string;
  imovel_id: string;
  appointment_id: string;
  corretor_id: string | null;
  imovel_nome: string;
  contato_nome: string | null;
  contact_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface ContextoImobiliario {
  contatos: Array<{ id: string; name: string }>;
  membros: Array<{ user_id: string; nome: string }>;
  agendamentos: Array<{
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    contact_id: string | null;
  }>;
}
export const RECURSOS_IMOBILIARIOS = ["imoveis", "corretores", "interessados", "visitas"] as const;
export type RecursoImobiliario = (typeof RECURSOS_IMOBILIARIOS)[number];
