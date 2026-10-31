<p align="center">
  <img src="docs/screenshots/hoje-hero.png" alt="Tela Hoje do Task Gaming: nível, meta do dia, ritmo, foco e recordes" width="900">
</p>

<h1 align="center">Task Gaming</h1>

<p align="center">
  Gestão de tarefas de trabalho com a mecânica de um app de treino.<br>
  Cronômetro, pontos, níveis, sequência diária, desafios com recorde, Kanban e cronograma — multitenant, para equipes.
</p>

---

## O que é

Cada tarefa é executada num **player cronometrado** (iniciar, pausar, retomar, concluir). Concluir dentro do tempo estimado rende bônus; estourar ou deixar pausada demais desconta. Os pontos alimentam **nível**, **sequência diária** e **ranking da equipe**. Além das tarefas, a equipe cria **desafios**: atividades repetíveis em que cada pessoa tenta bater o recorde de tempo dos colegas.

Por cima disso há a gestão de sempre: Kanban com drag-and-drop, lista com filtros, cronograma com dependências, pool de tarefas da equipe, validação de pontos pelo líder.

## Telas

| Player | Board |
|---|---|
| ![Player com cronômetro dentro do anel de progresso](docs/screenshots/player.png) | ![Kanban com colunas A fazer, Em andamento, Pausadas e Concluídas](docs/screenshots/board.png) |

| Equipe | Desafio |
|---|---|
| ![Ranking da equipe e feed de quem está ativo](docs/screenshots/equipe.png) | ![Página do desafio com recorde e ranking](docs/screenshots/desafio.png) |

| Cronograma | Perfil |
|---|---|
| ![Cronograma com barras por tarefa e setas de dependência](docs/screenshots/cronograma.png) | ![Perfil com nível, pontos e configurações pessoais](docs/screenshots/perfil.png) |

<details>
<summary><b>Modo claro, menu do usuário e mobile</b></summary>
<br>

![Tela Hoje em modo claro](docs/screenshots/hoje-claro.png)

| Menu do usuário | Mobile |
|---|---|
| ![Menu com perfil, tema e sair](docs/screenshots/menu-usuario.png) | ![Tela Hoje no celular](docs/screenshots/mobile.png) |

</details>

## Como a pontuação funciona

| Regra | Efeito |
|---|---|
| Concluiu em menos de 80% do estimado | **+15%** |
| Entre 80% e 150% | pontos base |
| Acima de 150% | **−10%** a cada 20% extra |
| Ficou ativa menos de 40% do tempo decorrido (muita pausa) | **−20%** |
| Piso | nunca abaixo de 50% dos pontos base |
| Concluiu em menos de 20% do estimado | pontos **retidos** até o líder validar |
| Conclusão manual pelo Kanban (sem cronômetro) | pontos base, sem bônus |

Outras regras que moldam o jogo:

- **Uma tarefa ativa por pessoa.** Iniciar outra pausa a anterior automaticamente.
- **Pool da equipe.** Tarefas sem dono ficam no pool; puxar é atômico — se duas pessoas clicam ao mesmo tempo, só uma leva.
- **Teto de abandono.** Um bloco esquecido aberto (browser fechado, almoço) trava em `max(2 × estimado, 30 min)`, e os intervalos entre blocos têm o mesmo teto. Esquecer de pausar não destrói sua pontuação.
- **Desafio = tarefa repetível.** Cada tentativa é uma tarefa com `challenge_id`; o recorde é o menor tempo em movimento válido (tentativa rejeitada pelo líder não conta, e o empate fica com quem concluiu primeiro). Só o executor pausa e conclui a própria tentativa.
- **Tentativas pontuadas por dia.** Cada desafio define quantas tentativas válidas por pessoa e por dia (no fuso do tenant) rendem pontos, 1 por padrão; as seguintes valem para o tempo e o recorde, mas rendem 0 pontos. Os pontos base de um desafio vão até 1000.
- **Dependências.** Grafo acíclico com detecção de ciclo; tarefa bloqueada não inicia.
- **Sequência.** Dias consecutivos com conclusão válida no fuso do tenant; fim de semana sem tarefa não quebra.
- **Níveis.** Iniciante 0 → Aprendiz 100 → Executor 300 → Veterano 600 → Especialista 1000 → Mestre 1500 → Lenda 2500 pontos.
- Pontos, ranking, sequência e nível são **derivados por consulta** — nada é materializado, então nunca ficam inconsistentes.

## Papéis

| Papel | Pode |
|---|---|
| `SUPER_ADMIN` | criar tenants e o primeiro admin de cada um; entrar como qualquer usuário (impersonação) |
| `TENANT_ADMIN` | equipes, usuários, convites, tarefas e desafios de qualquer equipe, ranking geral |
| `TEAM_LEADER` | tarefas, usuários e convites da própria equipe; cancelar, validar pontos, devolver ao pool |
| `MEMBER` | executar as próprias tarefas, puxar do pool, criar e tentar desafios da equipe |

Não existe cadastro aberto. Pessoas entram por **convite por email** (link válido por 7 dias) ou criadas pelo gestor com senha temporária e troca obrigatória no primeiro login. Sessões duram 10 horas; um novo login derruba o anterior.

### Permissões por capability

Cada ação sensível exige uma *capability* (`audit.read`, `user.update`, `export.csv`, `lead.import`…), com um padrão por papel em `src/server/roles.ts`. O gestor geral ajusta, por tenant, o que **líder** e **membro** podem em **Configurações → Permissões**; o papel de admin é fixo, e as capabilities que valem para o tenant inteiro (`tenant.manage`, `tenant.configure`, `team.manage`, `permissions.manage`, `audit.read`, `pipeline.configure`) não são delegáveis. Quem recebe uma capability delegada continua restrito à própria equipe. O escopo por equipe (`canManage`/`canSee`) segue valendo por baixo.

Usuários podem ser **desativados** (derruba as sessões e devolve o trabalho aberto ao pool) e reativados. Toda negação de acesso vira um evento `access.denied`.

## Auditoria

Toda mudança relevante grava um evento em `audit_events` **na mesma transação** da mudança: quem fez (e, na impersonação, quem estava por trás), o quê, em qual registro e o valor antes e depois. Cobre tarefas, usuários, convites, equipes, tenants, desafios, dependências, permissões, leads, oportunidades, etapas do funil, logins, falhas de login e impersonação. Os eventos são só de inserção.

- **Configurações → Auditoria** (admins): filtros por ação, entidade, ator e período, diff expansível e exportação CSV.
- Na página de uma tarefa, gestores veem a linha do tempo daquela tarefa.
- Não há purga automática: a tabela só cresce. Se pesar, o caminho é um script de retenção por data.

## Segurança de conta

- **Reset de senha por email**: a resposta é a mesma exista ou não o email. Sem `RESEND_API_KEY`, o link vai para o console do servidor.
- **Rate limit** no login (5 por minuto) e no pedido de reset (3 por 10 minutos), contado em memória, então vale para uma instância. O limite é por IP e lê `x-forwarded-for`: **atrás de proxy, garanta esse cabeçalho**, senão todo mundo cai no mesmo balde.
- **2FA TOTP** com códigos de recuperação, ativado no perfil. O gestor pode **exigir 2FA** para todo o tenant em Configurações → Organização. Ainda não há tela para resetar o 2FA de quem perdeu o celular e os códigos.

## Pipeline comercial

Leads, oportunidades e etapas do funil, multitenant e com a mesma visibilidade por equipe das tarefas.

- **Leads**: cadastro com aviso de duplicado (e-mail ou telefone), pool da equipe com claim atômico, atribuição e **importação CSV** com mapeamento de colunas e prévia.
- **Oportunidades**: nascem da conversão de um lead, na primeira etapa aberta. Mover para *Perdida* exige motivo; sair de uma etapa fechada exige a capability `opportunity.reopen`. Valor guardado em centavos.
- **Etapas**: configuráveis por tenant (Configurações → Funil de vendas), sempre com ao menos uma aberta, uma ganha e uma perdida. Só se exclui etapa nunca usada.
- **Funil**: forecast ponderado pela probabilidade da etapa, conversão entre etapas, taxa de ganho e ciclo médio, tudo derivado por consulta.
- **Follow-ups** são tarefas ligadas à oportunidade: usam o player, o Kanban e os pontos de sempre.
- Pontos por negócio ganho **não** existem ainda: todos os pontos vêm de tarefas.

## Stack

- **TanStack Start** (React, server functions, rotas por arquivo) — sem API separada
- **Better Auth** — email/senha, sessões, plugin admin (criação de usuários e impersonação)
- **Drizzle ORM** + **PostgreSQL 17** (Docker)
- **Tailwind CSS v4** — tema índigo com modo claro, fonte Outfit, sem biblioteca de componentes
- **@dnd-kit** para o Kanban; SVG puro para anéis, gráfico e cronograma
- **Vitest** — testes puros (pontuação, tempo, níveis, ciclos) e de integração contra o Postgres real
- **Resend** para os convites por email

## Rodar localmente

Pré-requisitos: Node 22+, pnpm, Docker.

```bash
cp .env.example .env            # gere BETTER_AUTH_SECRET com: openssl rand -base64 32
pnpm install
pnpm db:up                      # sobe o Postgres em Docker
pnpm db:migrate
pnpm db:seed                    # tenant "Administradora" + super admin (SEED_SUPERADMIN_* do .env)
pnpm dev                        # http://localhost:3100
```

Entre com o super admin, crie um tenant com slug `acme` em **Tenants**, e então:

```bash
pnpm db:seed:demo               # equipe Vendas: leo@acme.com (líder), bruno@ e carla@acme.com (membros) — senha demo-1234
```

Sem `RESEND_API_KEY` no `.env`, o link de convite é impresso no console do servidor em vez de enviado por email.

### Scripts

| Comando | Faz |
|---|---|
| `pnpm dev` | servidor de desenvolvimento na porta 3100 |
| `pnpm build` · `node --env-file=.env .output/server/index.mjs` | build e execução de produção |
| `pnpm test` | vitest (precisa do Postgres de pé) |
| `pnpm typecheck` · `pnpm lint` | TypeScript e ESLint |
| `pnpm db:generate` · `pnpm db:migrate` | migrations do Drizzle |
| `pnpm db:studio` | Drizzle Studio |

## Estrutura

```
src/
  db/            schema.ts (Drizzle), seed.ts, seed-demo.ts
  lib/           auth.ts (Better Auth), auth-client.ts, permissions.ts, theme.ts, format.ts, useElapsed.ts
  server/        *.ts        server functions (uma por domínio)
                 *.core.ts   lógica transacional, testável sem HTTP
                 roles.ts (papéis e capabilities) · audit.core.ts · time.ts · scoring.ts · levels.ts · stats.ts
  routes/        login · forgot-password · reset-password · two-factor · change-password · invite/$token
                 _app/       layout autenticado: index (Hoje), tasks, challenges, board, team, pipeline, leads, opportunities, profile, settings, admin
  components/    Ring, StatTile, Avatar, LevelTrack, PointsChart, TaskPlayer, CompletionModal, Modal (<dialog>), Shell, kanban/, pipeline/, leads/, Notes, NotificationBell, Timeline
docs/screenshots/
```

Convenções que importam:

- Arquivos de server function só exportam `createServerFn` ou valores puros. Qualquer função comum que toque o banco vive em `*.core.ts` — senão o `pg` vaza para o bundle do cliente.
- Toda consulta é filtrada por `tenant_id` vindo da sessão; nunca do cliente.
- Estilos próprios ficam em `@layer base/components` (para não vencer utilitários) e `@apply` só funciona sobre `@utility`.

## Testes

```bash
pnpm test
```

Cobrem: fórmula de pontuação, teto de tempo e gaps, detecção de ciclo, níveis, sequência; e, contra o banco real: claim concorrente do pool, pausa automática ao iniciar outra tarefa, cálculo no fechamento, devolver ao pool, cancelar, validar, conclusão manual, bloqueio por dependência, tentativa de desafio com recorde, aceite de convite.

## Fora de escopo (por enquanto)

OAuth/SSO, anexos (falta decidir onde guardar os arquivos), pontos por negócio ganho, e-mail de notificação, notificações push, WebSockets (o feed e as notificações usam polling de 15 s), API pública e webhooks, testes e2e de UI.
