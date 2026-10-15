# Jornada imobiliária

Prova em 15/10/2026 com build de produção, Supabase local recém-instalado e
dados sintéticos criados e removidos pela spec `tests/e2e/imobiliaria.spec.ts`.
Os dois testes passaram: operação de gestão e leitura sem ações de escrita.

- `carteira.png`: imóvel salvo no catálogo existente, com preço conferido no banco.
- `interessados.png`: contato qualificado com orçamento, região e próximo passo.
- `visitas.png`: imóvel disponível vinculado a compromisso real da Agenda.
- `visitas-mobile.png`: apresentação em 390 × 844, sem transbordamento horizontal.

A mesma jornada cadastra corretor, registra captação com próximo passo
obrigatório e confere o acesso pelo hub do CRM. Não envia mensagens reais.
Estas capturas comprovam a interface local; a ativação na Hyper é conferida
separadamente pelo procedimento de instalação.
