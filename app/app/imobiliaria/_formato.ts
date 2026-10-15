import { parseReaisToCents } from "@/lib/money";

/** Uma data local do formulário só vira UTC no envio; não muda o horário digitado. */
export function dataLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (!Number.isFinite(data.getTime())) return "";
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function dataParaApi(local: string): string | null {
  if (!local) return null;
  const data = new Date(local);
  if (!Number.isFinite(data.getTime()))
    throw new Error("Informe uma data válida para o próximo contato.");
  return data.toISOString();
}

export function valorEmCentavos(valor: string, rotulo: string): number {
  const centavos = parseReaisToCents(valor);
  if (centavos === null || !Number.isSafeInteger(centavos)) {
    throw new Error(`${rotulo}: informe um valor válido em reais.`);
  }
  return centavos;
}

export function listaDoCampo(valor: string): string[] {
  return [
    ...new Set(
      valor
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : "Não foi possível concluir. Tente novamente.";
}

export function dataLegivel(iso: string | null | undefined, idioma: string): string {
  if (!iso) return "Sem data definida";
  const data = new Date(iso);
  return Number.isFinite(data.getTime())
    ? data.toLocaleString(idioma, { dateStyle: "short", timeStyle: "short" })
    : "Data indisponível";
}
