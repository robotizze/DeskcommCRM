import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const compose = readFileSync(join(raiz, "docker-compose.aquila.yml"), "utf8");
const workflow = readFileSync(join(raiz, ".github", "workflows", "aquila-images.yml"), "utf8");
const hyper = readFileSync(join(raiz, "docker-compose.aquila-hyper.yml"), "utf8");
const supabase = readFileSync(join(raiz, "infra", "aquila", "supabase-hyper.override.yml"), "utf8");
const installer = readFileSync(join(raiz, "infra", "aquila", "install-hyper.sh"), "utf8");

describe("distribuição própria do Aquila Imob", () => {
  it("aplicativo, worker e scheduler usam o mesmo número de versão do fork", () => {
    for (const nome of ["aquila-imob", "aquila-imob-worker", "aquila-imob-scheduler"]) {
      expect(compose).toContain(`ghcr.io/robotizze/${nome}:\${AQUILA_VERSION:-0.1.0}`);
      expect(workflow).toContain(`name: ${nome}`);
    }
    expect(compose).not.toContain("ghcr.io/melgarafael/");
    expect(compose.match(/build: !reset null/g)).toHaveLength(2);
    expect(compose).not.toContain("ports:");
  });

  it("o CI constrói as três imagens em arquiteturas nativas e só publica a versão após o conjunto", () => {
    expect(workflow).toContain('tags: ["aquila-v*"]');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("arch: [amd64, arm64]");
    for (const arquivo of ["Dockerfile", "Dockerfile.worker", "Dockerfile.scheduler"]) {
      expect(workflow).toContain(`dockerfile: ${arquivo}`);
    }
    expect(workflow).toContain("ubuntu-24.04-arm");
    expect(workflow).toContain("needs: [contrato, construir]");
    expect(workflow).toContain("imagetools inspect");
    expect(workflow).toContain("já existe. Publique uma versão inédita.");
    expect(workflow).not.toContain(":latest");
    expect(workflow).toContain("if: github.event_name != 'pull_request'");
  });

  it("marca e endereço são injetados na instalação, sem chaves de produção no build", () => {
    expect(compose).toContain("APP_NAME: Aquila Imob");
    expect(compose).toContain("NEXT_PUBLIC_APP_URL: https://imob.aquila.ia.br");
    expect(compose).not.toContain("SUPABASE_SERVICE_ROLE_KEY:");
    expect(workflow).not.toContain("secrets.SUPABASE");
    expect(workflow).toContain("org.opencontainers.image.licenses=MIT");
    expect(workflow).toContain("gerar-catalogo-de-extensoes.ts --conferir");
  });

  it("o smoke verifica respostas HTTP, todos os hashes servidos e o login com ambiente completo", () => {
    expect(workflow).toContain('fetch(base + "/extensoes/catalogo.json")');
    expect(workflow).toContain('fetch(base + "/packages/" + entry.sha256 + ".json")');
    expect(workflow).toContain('fetch(base + "/login"');
    expect(workflow).toContain("entry.sha256");
    expect(workflow).toContain("-e WAHA_WEBHOOK_BASE_URL=");
    expect(workflow).toContain("-e CPF_ENCRYPTION_KEY=");
  });

  it("a Hyper reutiliza só o proxy; banco e transporte ficam nas redes próprias", () => {
    expect(hyper).toContain('profiles: ["aquila-caddy-proprio-desligado"]');
    expect(hyper).toContain("127.0.0.1:");
    expect(hyper).toContain("name: aquila-imob-ingress");
    expect(supabase.match(/container_name: !reset null/g)).toHaveLength(11);
    expect(supabase).toContain("ports: !reset []");
    expect(supabase).toContain("aliases: [aquila-imob-db]");
    expect(supabase).not.toMatch(/aquila3|coolify|supabase-db\]/);
    expect(installer).toContain("--single-transaction < supabase/baseline.sql");
    expect(installer).toContain("public.fn_modulo_instalar(v_actor, v_op, 'imobiliaria')");
    expect(installer).toContain("690080884040e238926ba22606e8c05a3536829b");
    expect(installer).toContain("--skip-deps --ref self-hosted/v0.8.1");
    expect(installer).not.toMatch(
      /\bbash install\.sh|\bdown -v|\bcaddy reload|\bsystemctl|\bapt-get/,
    );
  });
});
