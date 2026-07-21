# Hades + Hermes Agent

Hades agora pode usar o Hermes como agente principal.

O objetivo desta integracao e manter o Hades leve:

- Hades cuida da UI desktop, audio, transcricao, janela flutuante e fallback.
- Hermes cuida do MiniChat, sugestoes, memoria persistente, contexto pessoal, web atual, APIs externas, CLI e tarefas multi-step.
- Gemini fica no caminho rapido de transcricao ao vivo e nos titulos de sessao.
- Hades envia apenas contexto compacto para economizar tokens.

## Como o roteamento funciona

Quando Hermes esta ativo como agente principal, o MiniChat envia o turno direto para o Hermes.

O fallback Gemini continua existindo para quando Hermes estiver desligado ou falhar. Nesse fallback, o Hades tende a chamar `ask_hermes` quando o pedido envolve:

- clima/tempo, web atual ou Google
- APIs externas, CLI, terminal ou ferramentas fora do Hades
- pesquisa profunda ou tarefas multi-step
- curriculo, entrevista, documentos, historico, preferencias ou memoria pessoal
- modos `Entrevista`, `Ajuda`, `Ideias` ou `Codigo`

Ele tende a chamar `remember_with_hermes` quando o usuario pede para lembrar, salvar, guardar, anotar ou memorizar algo.

## Transcricoes e reunioes

A transcricao ao vivo do Susurro continua usando Gemini Live, porque precisa ser o caminho mais rapido.

Quando uma sessao de transcricao e fechada, o Hades arquiva a reuniao e dispara uma chamada ao Hermes em background:

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

Endpoint padrao usado pelo Hades:

```txt
http://127.0.0.1:8642/v1
```

O Hades aceita a Base URL com ou sem `/v1`.

## Configuracao no Hades

Abra `Settings > Agente` e configure:

- `Ativar Hermes`: permite delegar tarefas para o agente.
- `Base URL`: por padrao `http://127.0.0.1:8642`.
- `API key`: a mesma chave definida em `API_SERVER_KEY`.
- `Session key`: escopo de memoria do Hermes. Use algo estavel, como `hades-default`.
- `Modelo`: identificador do modelo OpenAI-compatible exposto pelo Hermes.
- `Contexto max`: limite de caracteres enviados pelo Hades em cada chamada.
- `Resumo reuniao max`: limite de caracteres enviados ao Hermes ao fechar uma transcricao.
- `Hermes como agente principal`: faz o MiniChat usar Hermes para tudo, com Gemini para transcricao rapida, titulos de sessao e fallback.

Use `Testar Hermes` para validar a conexao.

## Memoria

O Hermes gerencia a memoria dele. O Hades nao configura nem le o diretorio interno de memoria do Hermes.

A tela `Agente` mostra apenas o uso local das chamadas feitas pelo Hades: chamadas, falhas, caracteres enviados, caracteres recebidos e tokens estimados.

Para enviar curriculo, documento ou ideia:

1. Abra `Settings > Agente`.
2. Cole o texto em `Enviar Memoria`.
3. Escolha o tipo, por exemplo `Curriculo`.
4. Clique em `Enviar ao Hermes`.

O Hades nao cria embeddings nem banco vetorial nesse fluxo. Ele pede para o Hermes resumir e registrar a memoria persistente.

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

Quando aparecer uma pergunta de entrevista, o Hades pode chamar o Hermes para recuperar contexto do curriculo e montar uma resposta.

Para perguntas tecnicas, o prompt permite resposta com codigo quando isso for util.
