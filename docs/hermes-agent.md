# Metis + Hermes Agent

Metis agora pode usar o Hermes como agente principal.

O objetivo desta integracao e manter o Metis leve:

- Metis cuida da UI desktop, audio, transcricao, janela flutuante e fallback.
- Hermes cuida do MiniChat, sugestoes, memoria persistente, contexto pessoal, web atual, APIs externas, CLI e tarefas multi-step.
- Gemini fica no caminho rapido de transcricao ao vivo e nos titulos de sessao.
- Metis envia apenas contexto compacto para economizar tokens.

## Como o roteamento funciona

Quando Hermes esta ativo como agente principal, o MiniChat envia o turno direto para o Hermes.

O fallback Gemini continua existindo para quando Hermes estiver desligado ou falhar. Nesse fallback, o Metis tende a chamar `ask_hermes` quando o pedido envolve:

- clima/tempo, web atual ou Google
- APIs externas, CLI, terminal ou ferramentas fora do Metis
- pesquisa profunda ou tarefas multi-step
- curriculo, entrevista, documentos, historico, preferencias ou memoria pessoal
- modos `Entrevista`, `Ajuda`, `Ideias` ou `Codigo`

Ele tende a chamar `remember_with_hermes` quando o usuario pede para lembrar, salvar, guardar, anotar ou memorizar algo.

## Dreaming

O Dreaming nao usa mais Gemini. O ciclo usa a OpenAI Responses API com
`gpt-5.6-luna` para extrair no maximo cinco aprendizados reutilizaveis das
sessoes recentes.

Depois da consolidacao:

1. O Metis salva uma copia de auditoria em `~/.Metis/memory/learnings.json`.
2. O Metis inicia o prompt do Hermes informando que existem novos aprendizados.
3. O prompt inclui IDs estaveis, data, modelo, quantidade de sessoes e os bullets.
4. O Hermes usa a memoria persistente dele para registrar o conhecimento final.
5. Se o Hermes estiver indisponivel, a entrada permanece `pending` e o Metis
   tenta novamente em um proximo ciclo sem chamar a OpenAI novamente.

Configure a chave em `Configuracoes > Configuracoes > OpenAI`. A chave e salva
no arquivo de configuracoes criptografado do Metis. A requisicao usa
`store: false`, baixa verbosidade e esforco de raciocinio `none`.

## Transcricoes e reunioes

A transcricao ao vivo do Susurro continua usando Gemini Live, porque precisa ser o caminho mais rapido.

Quando uma sessao de transcricao e fechada, o Metis arquiva a reuniao e dispara uma chamada ao Hermes em background:

- gera resumo em portugues
- extrai decisoes, tarefas, riscos e perguntas abertas
- pede ao Hermes para salvar fatos, compromissos e preferencias reutilizaveis na memoria persistente
- grava o resultado em `hermesSummary` dentro do historico da sessao

Essa chamada usa a skill interna `hades_meeting_summary`.

## Configuracao do Hermes

No Hermes, habilite o API server no arquivo `~/.hermes/.env`:

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=troque-esta-chave
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
```

Depois inicie o gateway:

```bash
hermes gateway
```

Endpoint padrao usado pelo Metis:

```txt
http://127.0.0.1:8642/v1
```

O Metis aceita a Base URL com ou sem `/v1`.

## Configuracao no Metis

Abra `Settings > Agente` e configure:

- `Ativar Hermes`: permite delegar tarefas para o agente.
- `Base URL`: por padrao `http://127.0.0.1:8642`.
- `API key`: a mesma chave definida em `API_SERVER_KEY`.
- `Session key`: escopo de memoria do Hermes. Use algo estavel, como `hades-default`.
- `Modelo`: identificador do modelo OpenAI-compatible exposto pelo Hermes.
- `Contexto max`: limite de caracteres enviados pelo Metis em cada chamada.
- `Resumo reuniao max`: limite de caracteres enviados ao Hermes ao fechar uma transcricao.
- `Hermes como agente principal`: faz o MiniChat usar Hermes para tudo, com Gemini para transcricao rapida, titulos de sessao e fallback.

Use `Testar Hermes` para validar a conexao.

## Memoria

O Hermes gerencia a memoria dele. O Metis nao configura nem le o diretorio interno de memoria do Hermes.

A tela `Agente` mostra apenas o uso local das chamadas feitas pelo Metis: chamadas, falhas, caracteres enviados, caracteres recebidos e tokens estimados.

Para enviar curriculo, documento ou ideia:

1. Abra `Settings > Agente`.
2. Cole o texto em `Enviar Memoria`.
3. Escolha o tipo, por exemplo `Curriculo`.
4. Clique em `Enviar ao Hermes`.

O Metis nao cria embeddings nem banco vetorial nesse fluxo. Ele pede para o Hermes resumir e registrar a memoria persistente.

## Uso de tokens

Para reduzir custo:

- o dashboard nao chama o Hermes automaticamente
- `Memorizar conversas automaticamente` vem desligado para chats comuns
- `Sincronizar tasks e personas` vem desligado
- cada chamada envia somente contexto local compacto
- documentos manuais sao enviados uma vez para o Hermes memorizar
- resumo automatico de reunioes envia somente ate `Resumo reuniao max`

Se quiser mais automacao, ligue:

- `Memorizar conversas automaticamente`
- `Sincronizar tasks e personas`

Essas opcoes aumentam chamadas ao Hermes.

## Modo Entrevista

Fluxo recomendado:

1. Envie seu curriculo para o Hermes pela tela `Agente`.
2. Defina `Modo ativo` como `Entrevista`.
3. Defina `Formato preferido` como `Codigo` ou `Codigo + explicacao` se a entrevista for tecnica.

Quando aparecer uma pergunta de entrevista, o Metis pode chamar o Hermes para recuperar contexto do curriculo e montar uma resposta.

Para perguntas tecnicas, o prompt permite resposta com codigo quando isso for util.
