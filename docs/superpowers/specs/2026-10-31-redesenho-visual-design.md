# Redesenho visual: SaaS premium claro

## Objetivo

Usar a tela inteira e dar ao sistema a cara de um SaaS premium, misturando as três referências enviadas:
pipeline em largura total com indicadores no topo e cartões de negócio (prints 1 e 3) e casca com barra lateral
em seções e dashboard em grade (print 2).

Decisões aprovadas: tema **claro como padrão**, acento **azul-violeta**, verde só para pontos e sucesso,
tema escuro mantido como opção. Abordagem: **tokens primeiro, telas depois**.

## Diagnóstico do estado atual

- `main` tem teto fixo de 1180px (`Shell.tsx`): num monitor de 1860px sobram cerca de 700px vazios.
- No pipeline os indicadores ficam abaixo do kanban, as colunas têm altura fixa (`min-h-[55vh]`) mesmo vazias e os filtros são `select` soltos.
- O bloco de perfil e nível ocupa a metade superior da barra lateral.
- Há 612 usos da paleta `neutral-*` e 106 do verde `xp-*` (44 arquivos): remapear tokens muda quase tudo sem editar cada tela.
- Linha de base do detector (`npx impeccable detect src/`): 3 achados, dois gradientes violeta (`Avatar.tsx`, `styles.css`) e uma borda lateral grossa (`kanban/Card.tsx`).

## Tokens

| Papel | Valor | Observação |
|---|---|---|
| Fundo do app | `#F4F5FA` | |
| Superfície (cartão) | `#FFFFFF` | borda `#E6E8F1`, sombra `0 1px 2px rgb(20 22 50 / .04)` |
| Texto principal | `#15162A` | 16,3:1 sobre o fundo |
| Texto secundário | `#5C5F7C` | 6,2:1 sobre branco |
| Texto terciário | `#666A89` | 4,5:1 ou mais sobre branco e sobre o fundo (o atual `#7B7F9C` reprova) |
| `brand` | `#4C5BDC` | botões, item ativo, links: 5,5:1 com texto branco |
| `brand-hover` | `#3F4DC9` | hover, nos dois temas (6,1:1 com texto branco) |
| `brand-soft` / `brand-ink` | claro `#EEF0FE` / `#3F4DC9`; escuro `#262B5C` / `#AAB4FF` | fundo suave e o texto sobre ele: selos, linha selecionada |
| `brand-ring` | claro `#5B6CF2`; escuro `#7C8BF5` | só decoração sem texto: anel de foco, gráficos |
| Sucesso | verde `xp-*`; no claro `xp-400` passa a `#15803D` (5,0:1; o atual `#1C9E54` dá 3,5:1) | pontos, meta batida, "no prazo" |
| Atenção / perigo | âmbar / rosa; no claro `rose-400` passa a `#BE123C` (o atual dá 4,3:1 sobre o fundo do selo) | "vence logo", "atrasada" |
| Escuro: texto terciário | `#9094B8` | o atual `#7B7FA4` dá 3,9:1 sobre o cartão |

Os tokens do acento têm nomes por papel (`brand`, `brand-soft`...), não uma rampa numerada: assim o mesmo nome serve nos dois temas.

- Raios: cartão 16, controle 12, chip 999. Escala tipográfica 12 / 13 / 14 / 16 / 20 / 28, fonte Outfit mantida, números em `tnum`.
- **Sem gradiente em violeta ou ciano**: o acento é sempre cor chapada (o detector reprova o contrário).
- Mecanismo do tema: hoje o escuro é o padrão e o claro inverte a rampa `neutral`. Passa a valer o inverso: a rampa clara fica em `@theme` e `html[data-theme='dark']` a sobrescreve. Sem atributo, o servidor renderiza claro; o script de boot só marca `dark` se o usuário escolheu escuro.
- A rampa escura é remapeada para o mesmo acento, e o verde `text-xp-400` continua só em pontos.

## Casca e uso de tela

- Barra lateral de 248px com seções rotuladas (Área de trabalho, Comercial, Equipe, Configurações). Item ativo em pílula `brand-600` com texto branco. O perfil e o nível viram um cartão compacto no rodapé.
- Topbar fixa de 64px com um **espaço de busca por página** (cada tela com lista injeta o próprio campo) e, à direita, tema, sino, equipe e avatar.
- Conteúdo fluido. Um `PageContainer` com três larguras: `full` (kanban, listas, dashboards), `wide` (cartões em grade, máximo 1680px) e `narrow` (formulários e detalhes, máximo 880px). Cabeçalho de página padronizado (`PageHeader`: título, subtítulo e ações na mesma linha).
- Abaixo de `lg` a barra lateral continua virando a faixa horizontal de hoje.

## Pipeline

- Indicadores no topo: pipeline aberto, forecast ponderado, taxa de ganho, ciclo médio e nº de negócios abertos. **Sem variação percentual**: não há histórico para calculá-la.
- A busca de negócio (filtra título e lead no cliente; a empresa não vem no cartão) ocupa o espaço de busca da topbar. A barra de filtros abaixo dos indicadores traz só os seletores em pílula (pipeline, equipe, dono, período), com "limpar".
- Kanban em largura total: colunas iguais, mínimo de 280px, altura da janela e rolagem dentro da coluna. Cabeçalho em pílula com ponto de cor por tipo de etapa, nome, contagem, total e ponderado.
- Cartão: título, lead, valor e previsão com ícones, dono à esquerda, **selo de situação à direita**. Selo derivado de `expectedCloseDate`: "Atrasada" (data passada), "Vence logo" (até 7 dias), "No prazo", sem selo se não há data ou a etapa é fechada. Função pura com teste.
- Conversão entre etapas continua abaixo, restilizada.

## Demais telas

- **Hoje**: grade de 12 colunas (indicadores, meta e nível, desempenho, fila, equipe, desafios) e a jornada em largura total.
- **Board** e **Leads**: mesmo padrão de barra de filtros, largura total e colunas do pipeline.
- **Configurações**: cabeçalho padronizado e formulário em `narrow`. A navegação entre as páginas já está no grupo Configurações da barra lateral, então não crio uma segunda.
- Detalhes e modais herdam os tokens; ajustes pontuais onde o detector ou a revisão visual apontarem.

## Entrega

1. Tokens, tema claro padrão e casca nova.
2. Pipeline.
3. Hoje, Board, Leads, Equipe e Desafios.
4. Configurações, detalhes, modais e revisão final.

Cada onda é um commit, com typecheck, lint e testes verdes.

## Critérios de aceite

- `npx impeccable detect src/` sem achados (os 3 da linha de base eliminados, nenhum novo).
- Contraste AA nos pares de texto dos tokens acima.
- Capturas antes e depois de cada onda, em claro e escuro, nas larguras 1440, 1860 e 390.
- Lógica nova pura (selo de situação, filtro de busca) com teste escrito antes.
- Sem regressão: suíte atual verde.

## Fora de escopo

Busca global ⌘K (funcionalidade nova no servidor), variação "vs mês passado" nos indicadores, menu "⋯" nos cartões, colapsar colunas, personalização de tema.

## Riscos

- A inversão do mecanismo de tema toca todas as telas de uma vez: a onda 1 precisa de revisão visual das telas principais nos dois temas antes de seguir.
- 61 arquivos usam cores fora da paleta (`emerald`, `rose`, `cyan`...) em tiles e selos: confirmar contraste na revisão final.
