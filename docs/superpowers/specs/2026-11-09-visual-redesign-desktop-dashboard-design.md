# Visual novo (glassmorphism) e dashboard de desktop — design

## Objetivo
Deixar o MedTracker bonito e moderno em todas as telas e transformar o desktop num dashboard, no estilo da referência enviada pelo Pedro (menu lateral, linha de indicadores, grade de cards).

## Decisões do Pedro
- Tema **claro** apenas.
- Fontes: as mesmas — Plus Jakarta Sans (títulos) e Inter (texto).
- Verde da marca mantido: `#A3D911`.
- Referência: dashboard financeiro "FinEdge" (sidebar de vidro, KPIs no topo, cards em grade).
- Desktop vira dashboard; celular mantém a navegação inferior com o visual novo.

## Linguagem visual
- **Fundo:** base `#F3F6EE` com três manchas grandes e desfocadas (verde-limão `#A3D911`, menta `#7FE0B0`, verde fundo `#2F9E5B`), fixas atrás de todo o app.
- **Vidro:** utilitários `glass` (branco 55%, blur 20px, borda branca 70%, sombra suave) e `glass-strong` (branco 75%) para cards, menus e diálogos. Cantos de 24px.
- **Inputs:** 48px de altura, cantos de 16px, fundo de vidro, rótulo acima, ícone opcional à esquerda, foco com borda verde e anel `primary/20`, estado de erro em vermelho.
- **Seletores de opção** (categoria, frequência): controle segmentado.
- **Botões:** 48px, cantos de 16px; primário verde com sombra verde; secundário de vidro; contorno translúcido.
- Remover o CSS herdado do template do Vite em `index.css` (largura fixa de 1126px no `#root`, texto centralizado, borda lateral, variáveis de modo escuro).

## Layout
- **Desktop (≥1024px):** menu lateral de vidro fixo (logo, Visão geral, Remédios, Progresso, Perfil, botão "Adicionar remédio") e conteúdo com largura máxima de 1400px.
- **Celular:** barra inferior de vidro flutuante.
- **Dashboard:** saudação conforme a hora + data; 4 indicadores (doses de hoje, adesão da semana, sequência, doses perdidas); grade com Próxima dose (7/12), Agenda de hoje (5/12), faixa Hoje (5/12) e Histórico do remédio selecionado (7/12). No celular, os mesmos blocos em coluna.
- **Login/cadastro:** no desktop, duas colunas (marca à esquerda, formulário em card de vidro à direita); no celular, só o card.
- **Cadastro de remédio:** card de vidro; no desktop, duas colunas (dados do remédio | frequência e horário).
- **Lista, Progresso, Perfil, Lembrete:** mesmos cards de vidro; perfil em duas colunas no desktop; botão flutuante "+" da lista só no celular.

## Fora de escopo
Modo escuro, busca global, novas funcionalidades de dados.
