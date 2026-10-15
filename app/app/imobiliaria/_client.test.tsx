import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import type { Contexto, Imovel } from "./_tipos";

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get, post, patch } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { ImobiliariaClient } from "./_client";
import { FormularioInteressado } from "./_formularios";

const contexto: Contexto = {
  contatos: [{ id: "00000000-0000-4000-8000-000000000001", name: "Contato da prova" }],
  membros: [{ user_id: "00000000-0000-4000-8000-000000000002", nome: "Corretor da prova" }],
  agendamentos: [],
};

const imovel: Imovel = {
  id: "00000000-0000-4000-8000-000000000003",
  produto_id: "00000000-0000-4000-8000-000000000004",
  codigo: "AP-104",
  nome: "Apartamento da prova",
  descricao: null,
  preco_cents: 45000000,
  moeda: "BRL",
  imagem_url: null,
  ativo: true,
  finalidade: "venda",
  tipo: "apartamento",
  bairro: "Centro",
  cidade: "São Paulo",
  uf: "SP",
  quartos: 2,
  banheiros: 1,
  vagas: 1,
  area_m2: 80,
  endereco: null,
  proprietario_id: null,
  corretor_id: null,
  etapa_captacao: "publicado",
  proximo_passo: null,
  proximo_contato_em: null,
  created_at: "2026-10-15T12:00:00Z",
  updated_at: "2026-10-15T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation((caminho: string) =>
    Promise.resolve({
      data: caminho.endsWith("/contexto") ? contexto : caminho.endsWith("/imoveis") ? [imovel] : [],
    }),
  );
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
});
afterEach(cleanup);

describe("operação imobiliária", () => {
  it("exibe a carteira real e mantém leitores sem ações de escrita", async () => {
    render(<ImobiliariaClient podeGerenciar={false} podeQualificar={false} podeInstalar={false} />);
    expect(await screen.findByText("Apartamento da prova")).toBeInTheDocument();
    expect(screen.getByText("R$ 450.000,00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar imóvel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver no catálogo" })).toHaveAttribute(
      "href",
      "/app/products?busca=AP-104",
    );
  });

  it("mostra ausência do módulo com porta para administrador, sem carteira vazia falsa", async () => {
    get.mockRejectedValue(
      new ApiError(409, "module_not_installed", undefined, "prova", "Módulo indisponível"),
    );
    render(<ImobiliariaClient podeGerenciar podeQualificar podeInstalar />);
    expect(await screen.findByText("Módulo imobiliário indisponível")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Gerenciar módulos/ })).toHaveAttribute(
      "href",
      "/admin/modulos",
    );
    expect(screen.queryByText("Sua carteira começa aqui")).not.toBeInTheDocument();
  });

  it("preserva o formulário e o contexto quando salvar falha", async () => {
    post.mockRejectedValue(
      new ApiError(409, "conflict", undefined, "prova", "Código já utilizado"),
    );
    render(<ImobiliariaClient podeGerenciar podeQualificar podeInstalar={false} />);
    await screen.findByText("Apartamento da prova");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar imóvel" }));
    const dialogo = screen.getByRole("dialog");
    const formulario = dialogo.querySelector("form")!;
    fireEvent.change(within(dialogo).getByLabelText("Código *"), { target: { value: "AP-200" } });
    fireEvent.change(within(dialogo).getByLabelText("Nome do imóvel *"), {
      target: { value: "Novo apartamento" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Preço em R$ *"), {
      target: { value: "249.90" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Bairro *"), { target: { value: "Centro" } });
    fireEvent.change(within(dialogo).getByLabelText("Cidade *"), {
      target: { value: "São Paulo" },
    });
    fireEvent.change(within(dialogo).getByLabelText("UF *"), { target: { value: "sp" } });
    fireEvent.submit(formulario);
    expect(await screen.findByRole("alert")).toHaveTextContent("Código já utilizado");
    expect(screen.getByDisplayValue("Novo apartamento")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      "/api/v1/imobiliaria/imoveis",
      expect.objectContaining({ preco_cents: 24990, uf: "SP", etapa_captacao: "publicado" }),
    );
  });

  it("captação aberta exige próximo passo e deixa publicado encerrar esta exigência", async () => {
    render(<ImobiliariaClient podeGerenciar podeQualificar podeInstalar={false} />);
    await screen.findByText("Apartamento da prova");
    fireEvent.click(screen.getByLabelText("Só captações abertas"));
    fireEvent.click(screen.getAllByRole("button", { name: "Nova captação" })[0]!);
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByLabelText("Próximo passo *")).toBeRequired();
    fireEvent.change(within(dialogo).getByLabelText("Etapa da captação"), {
      target: { value: "publicado" },
    });
    expect(within(dialogo).getByLabelText("Próximo passo")).not.toBeRequired();
  });

  it("não envia orçamento invertido e informa como corrigir", async () => {
    const salvar = vi.fn();
    render(
      <FormularioInteressado
        contexto={contexto}
        corretores={[]}
        salvar={salvar}
        fechar={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Orçamento mínimo em R$"), {
      target: { value: "600.000,00" },
    });
    fireEvent.change(screen.getByLabelText("Orçamento máximo em R$ *"), {
      target: { value: "450.000,00" },
    });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "O orçamento máximo precisa ser maior ou igual ao mínimo.",
      ),
    );
    expect(salvar).not.toHaveBeenCalled();
  });
});
