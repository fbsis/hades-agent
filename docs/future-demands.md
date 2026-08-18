# Demandas futuras

Este documento registra funcionalidades planejadas que ainda não estão autorizadas para implementação.

As demandas descritas aqui servem como referência de produto e engenharia. A presença de uma demanda neste arquivo não autoriza alterações em código, schemas, persistência ou interfaces.

## Reuniões periódicas

**Status:** Planejada — não implementar agora

### Objetivo

Adicionar o tipo de reunião `Periodic meeting` para conversas que acontecem repetidamente, como daily, planning, retrospectiva e acompanhamento semanal.

Uma reunião periódica deve funcionar como uma série. Cada execução será uma ocorrência independente, preservando sua própria transcrição, checklist, resumo, decisões, respostas e gravações.

### Comportamento esperado

#### Série e ocorrências

- Manter uma série recorrente com configuração e histórico compartilhados.
- Suportar recorrência diária, em dias úteis, semanal, quinzenal, mensal e por intervalo personalizado.
- Usar a recorrência apenas para calcular e exibir a próxima data.
- Criar uma ocorrência somente quando o usuário clicar em **Iniciar próxima**.
- Impedir duas ocorrências ativas da mesma série.
- Preservar nas ocorrências antigas a configuração existente no momento em que foram criadas.
- Aplicar alterações feitas na série somente às ocorrências futuras.

#### Pontos para falar

- Permitir que a série mantenha um modelo de checklist chamado **Pontos para falar**.
- Copiar os itens do modelo, inicialmente desmarcados, ao criar cada ocorrência.
- Permitir adicionar, editar, remover, reordenar e marcar itens durante a reunião.
- Não alterar automaticamente o modelo da série quando o checklist de uma ocorrência for editado.
- Oferecer uma ação explícita para salvar o checklist atual como novo modelo da série.
- Incluir pontos ainda não abordados no contexto utilizado pela IA durante a ocorrência.

#### Resumo e decisões

- Gerar um resumo estruturado com:
  - Resumo geral.
  - Atualizações importantes.
  - Pontos abordados.
  - Pontos não abordados.
  - Decisões tomadas.
  - Decisões que precisam ser tomadas.
  - Próximos passos.
- Permitir que a IA sugira decisões pendentes a partir da transcrição.
- Exigir confirmação ou descarte pelo usuário antes de consolidar uma decisão sugerida.
- Mostrar somente decisões confirmadas na seção **Decisões a tomar** da visão geral.
- Manter as decisões exclusivamente no histórico da ocorrência onde foram identificadas.
- Não transportar decisões automaticamente para a próxima ocorrência.
- Mostrar **Nenhuma decisão pendente identificada** quando não houver decisões confirmadas.

#### Visão geral

- Exibir a próxima data calculada da série.
- Exibir a última ocorrência e seu status.
- Apresentar o histórico cronológico de ocorrências.
- Mostrar duração, data e status de cada ocorrência.
- Disponibilizar a ação **Iniciar próxima**.
- Destacar decisões a tomar antes do resumo completo de uma ocorrência.

### Alterações futuras de dados e interfaces

- Ampliar `MeetingMode` com o valor `periodic`.
- Criar uma entidade `PeriodicMeetingSeries` separada das sessões.
- Criar uma regra `RecurrenceRule` com frequência, intervalo, dias da semana, dia do mês, horário, fuso e data inicial.
- Ampliar `InterviewSession` com referência à série, número da ocorrência, data prevista, checklist e decisões.
- Persistir séries separadamente das sessões existentes.
- Adicionar operações IPC para criar, editar, listar e excluir séries, calcular a próxima data, iniciar ocorrências, salvar checklists e revisar decisões.
- Adicionar o filtro **Periódicas** ao CRUD de reuniões.
- Adicionar uma visão da série com configuração, próxima data e histórico.
- Adicionar um painel recolhível **Pontos para falar** à sala ao vivo.

### Critérios de aceite

- Todas as frequências suportadas calculam corretamente a próxima data.
- Horário local, fuso e mudanças de horário são respeitados.
- **Iniciar próxima** cria exatamente uma ocorrência.
- A ocorrência recebe uma cópia da configuração, documentos e checklist da série.
- Alterar a série não modifica ocorrências antigas.
- Não é possível manter duas ocorrências ativas da mesma série.
- O checklist pode ser editado e marcado durante a reunião.
- Pontos não abordados aparecem no resumo estruturado.
- Decisões sugeridas não são tratadas como confirmadas sem ação do usuário.
- Decisões confirmadas aparecem na visão geral da ocorrência.
- Decisões não são copiadas para a próxima ocorrência.
- Reuniões e entrevistas existentes continuam funcionando sem migração obrigatória.
- Excluir uma série preserva seu histórico por padrão.
- Falhas da IA não removem transcrição, checklist ou resumo anterior.

### Decisões de produto confirmadas

- Usar o modelo **série + histórico de ocorrências**.
- Suportar recorrência completa, incluindo intervalos personalizados.
- Criar ocorrências somente por ação explícita do usuário.
- Usar checklist próprio por ocorrência, derivado de um modelo da série.
- A IA sugere decisões, mas o usuário precisa confirmá-las.
- Decisões permanecem apenas na ocorrência onde foram identificadas.
- Preservar o histórico ao excluir uma série, salvo escolha explícita em contrário.

### Fora do escopo atual

- Implementação de componentes ou fluxos na interface.
- Alteração de tipos, schemas ou arquivos de persistência.
- Criação de handlers IPC ou serviços de recorrência.
- Geração automática de ocorrências em segundo plano.
- Início automático de gravações ou reuniões.
- Notificações de calendário.
- Integrações com Google Calendar, Outlook ou serviços externos.
- Migrações de dados existentes.
