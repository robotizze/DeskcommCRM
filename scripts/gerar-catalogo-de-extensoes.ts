/**
 * Gera `extensoes/catalogo.json` a partir dos pacotes em `extensoes/pacotes/`.
 *
 * O catálogo é DERIVADO, nunca escrito à mão: o `sha256` e o `byte_length` de cada entrada
 * têm de ser os bytes exatos do pacote publicado, e é isso que o host confere ao baixar
 * (`validateArtifact`). Um catálogo digitado à mão diverge no primeiro pacote corrigido, e
 * o sintoma seria `extension_digest_mismatch` numa instalação de cliente — longe daqui.
 *
 * Cada pacote é validado pelo SCHEMA REAL (`parseManifest` + `checkCompatibility`), não por
 * uma cópia das regras: um gerador com regras próprias publicaria pacote que o host recusa.
 *
 * Uso:
 *   pnpm tsx scripts/gerar-catalogo-de-extensoes.ts            # grava
 *   pnpm tsx scripts/gerar-catalogo-de-extensoes.ts --conferir # só confere (é o que o CI roda)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  checkCompatibility,
  parseCatalog,
  parseManifest,
  type CatalogEntry,
} from "../lib/extensions/manifest";

const RAIZ = join(__dirname, "..");
const PACOTES = join(RAIZ, "extensoes", "pacotes");
const DESTINO = join(RAIZ, "extensoes", "catalogo.json");
const CATALOGO_PUBLICO = join(RAIZ, "public", "extensoes", "catalogo.json");
const PACOTES_PUBLICOS = join(RAIZ, "public", "packages");

/**
 * A origem de onde o host baixa os bytes.
 *
 * MEDIDO, e não óbvio: o host recusa origem COM CAMINHO — `parseCatalog` só aceita origem
 * exata, sem caminho, query ou fragmento, porque ele mesmo monta `/packages/<sha256>.json`
 * em cima dela. Consequência prática: **GitHub Pages de projeto não serve**
 * (`https://usuario.github.io/REPO` é recusado), e a hospedagem precisa ser um domínio ou
 * subdomínio dedicado. Provado nos três casos em `tests/unit/catalogo-de-extensoes-em-dia.test.ts`.
 *
 * Este fork distribui o catálogo Aquila no domínio escolhido para a instalação.
 * `EXTENSOES_ORIGEM` permite gerar para outra instalação sem alterar os pacotes.
 * A geração prepara os artefatos; servir o domínio depende da publicação do aplicativo.
 */
const ORIGEM = process.env.EXTENSOES_ORIGEM ?? "https://imob.aquila.ia.br";

function arquivosDePacote(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivosDePacote(caminho);
    return entrada.name.endsWith(".json") ? [caminho] : [];
  });
}

interface Extra {
  publisher_label?: string;
  homepage?: string;
  repository?: string;
  tags?: string[];
  published_at?: string;
}

/** Metadado de LOJA: mora aqui, no artefato revisado, e nunca dentro do pacote (ADR-0003, D3). */
const LOJA: Record<string, Extra> = JSON.parse(
  readFileSync(join(RAIZ, "extensoes", "loja.json"), "utf8"),
) as Record<string, Extra>;

async function main() {
  const conferir = process.argv.includes("--conferir");
  const entries: CatalogEntry[] = [];
  const artefatos: Array<{ caminho: string; bytes: Buffer }> = [];

  for (const caminho of arquivosDePacote(PACOTES).sort()) {
    const bytes = readFileSync(caminho);
    const manifest = parseManifest(new Uint8Array(bytes));
    const compat = checkCompatibility(manifest);
    if (!compat.compatible) {
      throw new Error(
        `${relative(RAIZ, caminho)}: incompatível com este host (${compat.reason}). ` +
          `Um pacote que o host recusa não pode entrar no catálogo.`,
      );
    }
    const chave = `${manifest.publisher}/${manifest.name}`;
    const extra = LOJA[chave];
    if (!extra) throw new Error(`${chave}: sem metadado de loja em extensoes/loja.json`);

    const digest = createHash("sha256").update(bytes).digest("hex");
    artefatos.push({ caminho: join(PACOTES_PUBLICOS, `${digest}.json`), bytes });
    entries.push({
      publisher: manifest.publisher,
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      host_api: manifest.host_api,
      display: manifest.display,
      permissions: manifest.permissions,
      sha256: digest,
      byte_length: statSync(caminho).size,
      ...extra,
    });
  }

  if (entries.length === 0) throw new Error("nenhum pacote em extensoes/pacotes/");

  // A revisão é monotônica por origem: o host recusa revisão menor, e recusa a MESMA revisão
  // com conteúdo diferente. Deriva do conteúdo para não depender de alguém lembrar de subir.
  const corpo = { format_version: 1 as const, origin: ORIGEM, entries };
  const anterior = (() => {
    try {
      return JSON.parse(readFileSync(DESTINO, "utf8")) as {
        origin: string;
        revision: number;
        entries: unknown[];
      };
    } catch {
      return null;
    }
  })();
  const mudou =
    anterior === null ||
    anterior.origin !== corpo.origin ||
    JSON.stringify(anterior.entries) !== JSON.stringify(corpo.entries);
  const revision = anterior === null ? 1 : mudou ? anterior.revision + 1 : anterior.revision;

  const catalogo = JSON.stringify({ ...corpo, revision }, null, 2) + "\n";
  // A vitrine também é entrada externa: origem e metadados precisam passar
  // pelo contrato real antes de os bytes serem distribuídos.
  parseCatalog(new TextEncoder().encode(catalogo));

  if (conferir) {
    const atual = readFileSync(DESTINO, "utf8");
    if (atual !== catalogo) {
      throw new Error(
        "extensoes/catalogo.json está fora de dia com os pacotes. " +
          "Rode: pnpm tsx scripts/gerar-catalogo-de-extensoes.ts",
      );
    }
    if (readFileSync(CATALOGO_PUBLICO, "utf8") !== catalogo) {
      throw new Error("public/extensoes/catalogo.json diverge do catálogo validado.");
    }
    for (const artefato of artefatos) {
      if (!readFileSync(artefato.caminho).equals(artefato.bytes)) {
        throw new Error(`${relative(RAIZ, artefato.caminho)} diverge do pacote validado.`);
      }
    }
    console.info(`catálogo em dia: ${entries.length} pacote(s), revisão ${revision}`);
    return;
  }

  writeFileSync(DESTINO, catalogo);
  mkdirSync(join(RAIZ, "public", "extensoes"), { recursive: true });
  mkdirSync(PACOTES_PUBLICOS, { recursive: true });
  writeFileSync(CATALOGO_PUBLICO, catalogo);
  for (const artefato of artefatos) writeFileSync(artefato.caminho, artefato.bytes);
  console.info(
    `catálogo gerado: ${entries.length} pacote(s), revisão ${revision}, origem ${ORIGEM}`,
  );
}

void main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
