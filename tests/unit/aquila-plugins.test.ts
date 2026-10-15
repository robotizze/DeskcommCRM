import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { destinoDaCapacidade, permissaoDaCapacidade } from "@/lib/extensions/capacidades";
import {
  checkCompatibility,
  parseCatalog,
  parseManifest,
  validateArtifact,
} from "@/lib/extensions/manifest";

const raiz = join(__dirname, "..", "..");
const pasta = join(raiz, "extensoes", "pacotes", "aquila");
const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith(".json"));
const catalogo = parseCatalog(
  new Uint8Array(readFileSync(join(raiz, "extensoes", "catalogo.json"))),
);

describe("pacotes imobiliários Aquila", () => {
  it("distribui as quatro jornadas a partir do domínio próprio", () => {
    expect(catalogo.origin).toBe("https://imob.aquila.ia.br");
    expect(arquivos).toHaveLength(4);
    expect(catalogo.entries.filter((entrada) => entrada.publisher === "aquila")).toHaveLength(4);
    expect(readFileSync(join(raiz, "public", "extensoes", "catalogo.json"), "utf8")).toBe(
      readFileSync(join(raiz, "extensoes", "catalogo.json"), "utf8"),
    );
  });

  it.each(arquivos)("%s passa pelo contrato e verificador reais do host", async (nome) => {
    const bytes = new Uint8Array(readFileSync(join(pasta, nome)));
    const manifesto = parseManifest(bytes);
    const entrada = catalogo.entries.find(
      (item) => item.publisher === manifesto.publisher && item.name === manifesto.name,
    );
    expect(entrada).toBeDefined();
    expect(checkCompatibility(manifesto)).toEqual({ compatible: true, reason: null });
    expect(entrada!.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(entrada!.byte_length).toBe(bytes.byteLength);
    await expect(validateArtifact(bytes, entrada!)).resolves.toEqual(manifesto);
    const servido = new Uint8Array(
      readFileSync(join(raiz, "public", "packages", `${entrada!.sha256}.json`)),
    );
    expect(servido).toEqual(bytes);
    await expect(validateArtifact(servido, entrada!)).resolves.toEqual(manifesto);

    const cards = manifesto.contributions.crm_cards ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => card.action.capability === "imobiliaria.open")).toBe(true);
    for (const card of cards) {
      expect(destinoDaCapacidade(card.action.capability)).toMatch(/^\/app\//);
      expect(manifesto.permissions).toContain(permissaoDaCapacidade(card.action.capability));
    }
  });

  it("recusa bytes alterados mesmo quando o JSON continua válido", async () => {
    const bytes = readFileSync(join(pasta, arquivos[0]!));
    const manifesto = parseManifest(new Uint8Array(bytes));
    const entrada = catalogo.entries.find(
      (item) => item.publisher === manifesto.publisher && item.name === manifesto.name,
    )!;
    const adulterado = new Uint8Array(bytes);
    const posicao = bytes.indexOf(Buffer.from('"1.0.0"'));
    adulterado[posicao + 1] = "2".charCodeAt(0);
    await expect(validateArtifact(adulterado, entrada)).rejects.toMatchObject({
      code: "extension_digest_mismatch",
    });
  });

  it("a porta imobiliária é literal e não aceita um endereço vindo do pacote", () => {
    expect(destinoDaCapacidade("imobiliaria.open")).toBe("/app/imobiliaria");
    expect(destinoDaCapacidade("/app/settings/api-tokens")).toBeNull();
    expect(destinoDaCapacidade("imobiliaria.open?destino=/admin/marca")).toBeNull();
  });
});
