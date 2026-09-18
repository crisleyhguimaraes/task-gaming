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
- **Desafio = tarefa repetível.** Cada tentativa é uma tarefa com `challenge_id`; o recorde é o menor tempo em movimento válido.
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
                 roles.ts · time.ts · scoring.ts · levels.ts · stats.ts
  routes/        login · change-password · invite/$token
                 _app/       layout autenticado: index (Hoje), tasks, challenges, board, team, profile, settings, admin
  components/    Ring, StatTile, Avatar, LevelTrack, PointsChart, TaskPlayer, CompletionModal, Modal (<dialog>), Shell, kanban/, Timeline
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

OAuth/SSO, reset de senha por email, notificações push, WebSockets (o feed usa polling de 15 s), testes e2e de UI.
