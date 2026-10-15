import { z } from "zod";
import { ETAPAS_DE_CAPTACAO, ESTADOS_DE_INTERESSE, FINALIDADES, TIPOS_DE_IMOVEL } from "./tipos";

const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) => z.string().trim().max(max).nullable().optional();
const dinheiro = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const lista = z.array(texto(80)).max(30);
const referencia = z.uuid().nullable().optional();
const proximoPasso = opcional(500);
const proximoContato = z.iso.datetime({ offset: true }).nullable().optional();
const imagem = z
  .url()
  .refine((v) => new URL(v).protocol === "https:", "Use uma imagem com endereço HTTPS.")
  .nullable()
  .optional();

export const imovelCampos = z
  .object({
    codigo: texto(80),
    nome: texto(200),
    descricao: opcional(4000),
    preco_cents: dinheiro,
    moeda: z.literal("BRL").default("BRL"),
    imagem_url: imagem,
    ativo: z.boolean().default(true),
    finalidade: z.enum(FINALIDADES),
    tipo: z.enum(TIPOS_DE_IMOVEL),
    bairro: texto(120),
    cidade: texto(120),
    uf: z.string().regex(/^[A-Z]{2}$/),
    quartos: z.number().int().min(0).max(100).default(0),
    banheiros: z.number().int().min(0).max(100).default(0),
    vagas: z.number().int().min(0).max(100).default(0),
    area_m2: z.number().positive().max(1e9).nullable().optional(),
    endereco: opcional(300),
    proprietario_id: referencia,
    corretor_id: referencia,
    etapa_captacao: z.enum(ETAPAS_DE_CAPTACAO).default("publicado"),
    proximo_passo: proximoPasso,
    proximo_contato_em: proximoContato,
  })
  .strict();
export const imovelSchema = imovelCampos
  .refine(
    (v) => ["publicado", "encerrado"].includes(v.etapa_captacao) || !!v.proximo_passo?.trim(),
    { path: ["proximo_passo"], message: "Defina o próximo passo para a captação aberta." },
  )
  .transform((v) => ({ ...v, ativo: v.etapa_captacao === "publicado" && v.ativo }));

export const corretorSchema = z
  .object({
    user_id: z.uuid(),
    creci: texto(40),
    ativo: z.boolean().default(true),
    especialidades: lista.default([]),
    regioes: lista.default([]),
  })
  .strict();

export const interessadoCampos = z
  .object({
    contact_id: z.uuid(),
    finalidade: z.enum(FINALIDADES),
    tipo: z.enum(TIPOS_DE_IMOVEL).nullable().optional(),
    orcamento_min_cents: dinheiro.default(0),
    orcamento_max_cents: dinheiro,
    bairros: lista.default([]),
    quartos_min: z.number().int().min(0).max(100).default(0),
    prazo: opcional(200),
    corretor_id: referencia,
    status: z.enum(ESTADOS_DE_INTERESSE).default("aberto"),
    proximo_passo: proximoPasso,
    proximo_contato_em: proximoContato,
  })
  .strict();
export const interessadoSchema = interessadoCampos
  .refine((v) => v.orcamento_max_cents >= v.orcamento_min_cents, {
    path: ["orcamento_max_cents"],
    message: "O orçamento máximo deve ser maior ou igual ao mínimo.",
  })
  .refine((v) => ["concluido", "encerrado"].includes(v.status) || !!v.proximo_passo?.trim(), {
    path: ["proximo_passo"],
    message: "Defina o próximo passo para este interessado.",
  });

export const visitaSchema = z
  .object({
    imovel_id: z.uuid(),
    appointment_id: z.uuid(),
    corretor_id: referencia,
  })
  .strict();
export const esquemas = {
  imoveis: imovelSchema,
  corretores: corretorSchema,
  interessados: interessadoSchema,
  visitas: visitaSchema,
};
export const esquemasParciais = {
  // Zod 4 aplica defaults mesmo por dentro de optional(). PATCH nunca deve preencher campo ausente.
  imoveis: imovelCampos.partial().extend({
    moeda: imovelCampos.shape.moeda.removeDefault().optional(),
    ativo: imovelCampos.shape.ativo.removeDefault().optional(),
    quartos: imovelCampos.shape.quartos.removeDefault().optional(),
    banheiros: imovelCampos.shape.banheiros.removeDefault().optional(),
    vagas: imovelCampos.shape.vagas.removeDefault().optional(),
    etapa_captacao: imovelCampos.shape.etapa_captacao.removeDefault().optional(),
  }),
  corretores: corretorSchema.partial().extend({
    ativo: corretorSchema.shape.ativo.removeDefault().optional(),
    especialidades: corretorSchema.shape.especialidades.removeDefault().optional(),
    regioes: corretorSchema.shape.regioes.removeDefault().optional(),
  }),
  interessados: interessadoCampos.partial().extend({
    orcamento_min_cents: interessadoCampos.shape.orcamento_min_cents.removeDefault().optional(),
    bairros: interessadoCampos.shape.bairros.removeDefault().optional(),
    quartos_min: interessadoCampos.shape.quartos_min.removeDefault().optional(),
    status: interessadoCampos.shape.status.removeDefault().optional(),
  }),
  visitas: visitaSchema.partial(),
};
export const idSchema = z.uuid();
export const chaveIdempotenteSchema = z.uuid();
