import type { EtapaDeCaptacao, EstadoDeInteresse, TipoDeImovel } from "@/lib/imobiliaria/tipos";

export type {
  Imovel,
  Corretor,
  Interessado,
  Visita,
  ContextoImobiliario as Contexto,
} from "@/lib/imobiliaria/tipos";

export const TIPOS: Record<TipoDeImovel, string> = {
  casa: "Casa",
  apartamento: "Apartamento",
  terreno: "Terreno",
  comercial: "Comercial",
  rural: "Rural",
};
export const ETAPAS: Record<EtapaDeCaptacao, string> = {
  novo: "Nova captação",
  em_contato: "Em contato",
  documentacao: "Documentação",
  publicado: "Publicado",
  encerrado: "Encerrado",
};
export const STATUS: Record<EstadoDeInteresse, string> = {
  aberto: "Em qualificação",
  em_visita: "Em visita",
  proposta: "Proposta",
  concluido: "Concluído",
  encerrado: "Encerrado",
};
