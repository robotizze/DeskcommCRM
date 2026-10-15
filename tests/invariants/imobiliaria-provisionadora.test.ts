import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "imobiliaria",
  tabelas: ["imob_corretores", "imob_imoveis", "imob_interessados", "imob_visitas"],
  protecaoPropria: ["imob_corretores", "imob_imoveis", "imob_interessados", "imob_visitas"],
});
