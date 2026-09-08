# ai-memory MCP

Este guia instala o [`ai-memory`](https://github.com/alphaonedev/ai-memory-mcp)
diretamente em uma máquina Linux e o conecta ao Metis por MCP. Ele não usa
Docker.

## Escolha da conexão

Há três opções seguras:

| Cenário | URL no Metis | HTTPS |
| --- | --- | --- |
| `ai-memory` no mesmo computador que o Metis | `http://127.0.0.1:9077/mcp` | Não é necessário |
| `ai-memory` em VM/LXC, acessado por túnel SSH local | `http://127.0.0.1:9077/mcp` | Não é necessário; o SSH cifra o tráfego |
| `ai-memory` em VM/LXC, acessado diretamente pela rede | `https://memory.exemplo.com/mcp` | Obrigatório no Metis |

`localhost` e `127.0.0.1` sempre identificam a máquina onde o Metis está
rodando. Portanto, o endereço não aponta sozinho para uma VM remota.

## 1. Instalar no servidor

O instalador oficial escolhe o binário adequado para Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/alphaonedev/ai-memory-mcp/main/install.sh | sh

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

ai-memory --version
```

Para manter o `PATH` após um novo login, adicione a linha `export` ao arquivo
de inicialização do shell, como `~/.bashrc` ou `~/.zshrc`.

## 2. Criar a identidade e o diretório de dados

```bash
mkdir -p "$HOME/.local/share/ai-memory"
ai-memory identity --agent-id metis generate
```

A identidade assina operações atribuídas ao agente `metis`. O banco SQLite
será mantido em `$HOME/.local/share/ai-memory/ai-memory.db`.

## 3. Gerar a chave de acesso

```bash
openssl rand -hex 32
```

Guarde o resultado em um gerenciador de senhas. Nos exemplos seguintes,
substitua `CHAVE_FORTE_AQUI` pelo valor gerado. Nunca coloque a chave no Git.

## 4A. Executar localmente ou atrás de proxy/túnel

Esta é a configuração recomendada para Caddy, Nginx ou túnel SSH. O serviço
fica acessível somente dentro do servidor:

```bash
export AI_MEMORY_API_KEY="CHAVE_FORTE_AQUI"
export AI_MEMORY_REQUIRE_API_KEY=1

ai-memory \
  --db "$HOME/.local/share/ai-memory/ai-memory.db" \
  --agent-id metis \
  serve \
  --host 127.0.0.1 \
  --port 9077
```

Teste no próprio servidor:

```bash
curl -fsS http://127.0.0.1:9077/api/v1/health
```

### Acessar por túnel SSH

Execute no computador onde o Metis está instalado:

```bash
ssh -N -L 9077:127.0.0.1:9077 usuario@servidor
```

Enquanto o túnel estiver aberto, use
`http://127.0.0.1:9077/mcp` no Metis. Não abra a porta `9077` no firewall.

### Acessar por domínio e proxy HTTPS

Configure o proxy para encaminhar:

```text
https://memory.exemplo.com/mcp -> http://127.0.0.1:9077/mcp
```

Continue enviando a chave no cabeçalho `X-API-Key`. TLS protege a chave e as
memórias enquanto trafegam pela rede.

## 4B. HTTPS nativo, sem proxy

O `ai-memory` também aceita certificado e chave TLS diretamente. Nesse caso,
a porta `9077` pode ser publicada:

```bash
export AI_MEMORY_API_KEY="CHAVE_FORTE_AQUI"
export AI_MEMORY_REQUIRE_API_KEY=1

ai-memory \
  --db "$HOME/.local/share/ai-memory/ai-memory.db" \
  --agent-id metis \
  serve \
  --host 0.0.0.0 \
  --port 9077 \
  --tls-cert /caminho/fullchain.pem \
  --tls-key /caminho/privkey.pem
```

Use um certificado confiável pelo macOS. Um certificado autoassinado não será
aceito normalmente pelo cliente sem configuração adicional de confiança.

## 5. Configurar no Metis

Abra **Configurações > MCP**, ative MCP e use o editor JSON.

### Servidor na mesma máquina ou túnel SSH

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:9077/mcp",
      "headers": {
        "X-API-Key": "CHAVE_FORTE_AQUI"
      },
      "meetingKnowledge": {
        "enabled": true,
        "tool": "memory_store",
        "maxContentBytes": 48000,
        "arguments": {
          "namespace": "metis/meetings",
          "tier": "long",
          "tags": ["metis", "meeting"]
        },
        "conversationArguments": {
          "namespace": "metis/conversations",
          "tags": ["metis", "conversation"]
        }
      },
      "memoryContext": {
        "enabled": true,
        "tool": "memory_recall",
        "maxResultChars": 6000,
        "arguments": {
          "limit": 5
        }
      }
    }
  }
}
```

### Servidor remoto com HTTPS

```json
{
  "mcpServers": {
    "ai-memory": {
      "type": "streamable-http",
      "url": "https://memory.exemplo.com/mcp",
      "headers": {
        "X-API-Key": "CHAVE_FORTE_AQUI"
      },
      "meetingKnowledge": {
        "enabled": true,
        "tool": "memory_store",
        "maxContentBytes": 48000,
        "arguments": {
          "namespace": "metis/meetings",
          "tier": "long",
          "tags": ["metis", "meeting"]
        },
        "conversationArguments": {
          "namespace": "metis/conversations",
          "tags": ["metis", "conversation"]
        }
      },
      "memoryContext": {
        "enabled": true,
        "tool": "memory_recall",
        "maxResultChars": 6000,
        "arguments": {
          "limit": 5
        }
      }
    }
  }
}
```

Salve, teste a conexão e libere apenas as ferramentas que o modelo poderá
usar. Comece pelo perfil principal de memória: armazenar, recuperar, pesquisar,
listar e consultar capacidades.

## Enviar reuniões automaticamente

O bloco `meetingKnowledge` é independente de `allowedTools`. Quando `enabled`
está ativo, o Metis envia o resumo **e a conversa transcrita** de cada reunião
concluída diretamente para a tool indicada. A tool `memory_store` e os campos
`title` e `content` são
detectados automaticamente no `ai-memory`; por isso `tool`, `titleField` e
`contentField` podem ser omitidos nesse servidor.

Como o `ai-memory` limita o conteúdo de uma memória a 64 KB, o padrão
`maxContentBytes: 48000` mantém uma margem segura. Conversas maiores são
divididas em partes numeradas, preservando toda a transcrição e um título
estável para deduplicação.

O controle também aparece em cada cartão de servidor como **Enviar reuniões e
chats como conhecimento**. Cada MCP é tratado separadamente: você pode ter vários
servidores instalados, habilitar o envio em mais de um deles e deixar outros
apenas para tools comuns. O Metis registra o resultado por reunião e por
servidor, não reenvia depois de um sucesso e tenta novamente nos próximos
ciclos quando algum servidor estiver indisponível.

Na lista de reuniões, a coluna **Conhecimento** mostra `Enviando`, `Parcial`,
`Enviado` ou `Falhou`. Ao abrir a reunião, o cartão **Conhecimento MCP** detalha
por nome de servidor se a conversa e o resumo foram confirmados, quantas partes
foram aceitas, o horário da confirmação e a última mensagem de erro. `Enviado`
só aparece depois de uma resposta bem-sucedida da tool MCP.

A conversa não depende do resumo: se não houver chave da OpenAI ou a geração
do resumo falhar, a transcrição é enviada primeiro e o estado fica `Parcial`.
O Metis continua tentando produzir e enviar apenas o resumo, sem reenviar a
conversa já confirmada.

## Conversas normais no Dream Service

Ao encerrar um MiniChat, o Metis arquiva a conversa e aciona o Dream Service.
O ciclo envia todas as mensagens, com os papéis `Usuário` e `Metis`, para cada
servidor Knowledge selecionado. Conversas grandes usam as mesmas partes
numeradas das reuniões e o namespace padrão `metis/conversations`.

O histórico mostra `Enviando ao Knowledge`, `Knowledge confirmado`, `Knowledge
parcial` ou `Falha no Knowledge`. A confirmação só é gravada depois que a tool
MCP aceita todas as partes. Falhas permanecem na fila e são tentadas novamente
na inicialização, no ciclo diário ou quando outra conversa é encerrada.

Para uma tool com nomes de campos diferentes, mantenha a configuração flexível:

```json
{
  "meetingKnowledge": {
    "enabled": true,
    "tool": "add_knowledge",
    "titleField": "name",
    "contentField": "text",
    "maxContentBytes": 48000,
    "arguments": {
      "collection": "meetings",
      "visibility": "private"
    },
    "conversationArguments": {
      "collection": "conversations"
    }
  }
}
```

Todos os valores em `arguments` são encaminhados à tool. Para chats,
`conversationArguments` sobrescreve somente os valores que precisam ser
diferentes, reaproveitando todo o restante da configuração. O título e o
conteúdo são preenchidos pelo Metis nos campos configurados.

## Usar memória em chats e entrevistas

Com `memoryContext.enabled`, o Metis consulta o servidor antes de responder no
MiniChat e antes de gerar respostas ou sugestões de entrevista. Para o
`ai-memory`, a tool `memory_recall` e o campo `context` são detectados
automaticamente; os nomes explícitos no JSON continuam úteis para outros MCPs.

A tela MCP apresenta **MCPs de memória configurados**, reconhecidos pelo nome
do servidor ou pelas tools publicadas, e mostra quais estão conectados, recebem
reuniões e chats e ajudam nas respostas. Cada servidor pode ser ativado separadamente
com **Usar memória nas respostas**. Se `memoryContext` for omitido em uma
configuração antiga, ele herda o estado de `meetingKnowledge.enabled`.

As consultas aos vários servidores são paralelas, têm limite de oito segundos
e não impedem uma resposta caso uma memória esteja indisponível. Os resultados
são limitados por servidor e tratados como dados não confiáveis: comandos ou
instruções eventualmente armazenados na memória não podem controlar o agente.

## Segurança

- HTTP é aceito pelo Metis apenas para endereços de loopback.
- Para acesso direto a outra máquina, use HTTPS e `X-API-Key`.
- Não publique o banco SQLite nem o diretório de identidade por compartilhamento
  de rede.
- Faça backup do banco, incluindo os arquivos `-wal` e `-shm` quando existirem,
  ou pare o serviço antes de copiar.
- Não registre a chave em arquivos versionados, logs ou URLs.

## Referências

- [Instalação oficial](https://github.com/alphaonedev/ai-memory-mcp/blob/main/docs/INSTALL.md)
- [Guia de integração MCP](https://github.com/alphaonedev/ai-memory-mcp/blob/main/docs/integration-guide.md)
- [Guia administrativo](https://github.com/alphaonedev/ai-memory-mcp/blob/main/docs/ADMIN_GUIDE.md)
