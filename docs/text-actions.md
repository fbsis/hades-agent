# Ações de texto no macOS

Selecione um trecho em outro app e use **Option+Espaço**, padrão do WritingTools para Mac e novo padrão do Metis. Instalações antigas mantêm o atalho salvo; ajuste em Configurações → Teclas de Atalho. O perfil de desenvolvimento foi migrado somente nesse campo, preservando Option+D e as demais preferências.

Se WritingTools/outro app ocupar esse atalho, o Metis aguarda sua liberação e tenta registrar novamente a cada 5 segundos, sem remover os outros atalhos nem alterar/fechar o outro aplicativo. Pause os hotkeys ou encerre WritingTools para usar a mesma combinação no Metis. A configuração pessoal de WritingTools não foi importada: o macOS protegeu o arquivo de preferências, e não tentamos contornar a proteção.

## Captura e janela

- **Dentro do Metis/notas, o atalho captura o editor da janela que possui o foco de teclado**, sem Acessibilidade, Cmd+C ou clipboard. Isso também funciona com painéis flutuantes não ativantes: no macOS, eles podem receber teclado enquanto o app “frontmost” ainda é o navegador com outra página. Abrir o painel de ações não troca o vínculo do editor. Fechar/cancelar o painel devolve foco à janela de origem, não a outra janela web do mesmo processo.
- Em outros apps, a captura tenta ler a seleção pela Acessibilidade antes de recorrer a copiar/colar. O fallback espera os modificadores serem soltos e restaura os formatos conhecidos de clipboard (texto, HTML, RTF e imagem); não há garantia sobre formatos proprietários/gerenciadores externos.
- O dev (`Electron/Metis Dev`) precisa de suas próprias permissões em **Privacidade e Segurança → Acessibilidade** e **Automação → System Events**. Permissões do Metis instalado ou do WritingTools não são transferidas. O painel oferece botão para abrir a seção correspondente; não concede permissão automaticamente.
- No caminho externo, a janela vem do `AXWindow` do campo/`AXFocusedWindow`, não de `windows[0]`. Copiar nunca reativa o aplicativo. Ao aplicar, levanta somente a janela original, espera a ativação/foco estabilizar e verifica novamente janela/campo/range/texto imediatamente antes de colar. Metadados e texto para os scripts seguem por stdin, não pelos argumentos do processo. Diagnóstico registra só etapa e código de motivo, sem texto, títulos ou clipboard.
- Sucesso e erro ficam em memória no processo principal para o renderer buscá-los, mesmo quando o módulo React carrega depois do evento. Uma resposta inicial atrasada não pode apagar uma seleção mais recente.
- A janela tem fundo opaco, tamanho ajustável, carregamento explícito e fallback de falha de renderização. Nunca depende de uma área transparente vazia para explicar erros.
- Sem seleção/permissão, o campo **Texto selecionado** continua disponível para colar manualmente. A transformação funciona com esse texto, mas não há substituição automática em um app desconhecido.

## Transformação e aplicação

Escolha Corrigir, Reescrever, Traduzir, etc., ou uma instrução personalizada. Só essa ação envia texto à OpenAI já configurada; não depende de `work.home`, nem cria histórico/aprendizado automaticamente. A chave deve existir no perfil usado e o provedor exige internet/acesso ao modelo.

Ao escolher Traduzir, Corrigir, Reescrever, mudar tom ou outra transformação, o resultado **substitui diretamente** a seleção editável, sem uma segunda confirmação. Se não puder aplicar com segurança, mantém o resultado no painel para copiar. Substituição só é oferecida para origem reconhecida como editável, não para terminais ou seleção truncada acima de 30 mil caracteres. Ela confere ID da seleção, processo, janela, campo identificado e texto ainda selecionado antes de colar; se mudou, recusa e mantém o resultado para copiar. Não há garantia universal para editores com APIs de acessibilidade incompletas.

Dentro do Metis e das notas, **Traduzir/Corrigir/Reescrever no botão direito alteram diretamente o trecho selecionado no próprio editor**, sem abrir uma prévia, usar clipboard ou depender da Acessibilidade. Um bookmark em mundo isolado fica preso à janela/campo/range; a aplicação usa a edição nativa do Chromium, dispara os eventos do editor React e mantém o restante do documento. Campo, seleção, conteúdo ou janela alterados fazem a operação falhar fechada, exibindo o resultado já gerado para copiar (sem chamar a IA outra vez). Senhas e seleções acima do limite não recebem ações de transformação. Resumir/Explicar continuam somente resultado.

A substituição é de **texto simples**, não preserva automaticamente estilos RTF/negrito/links do documento. Resumir/Explicar são somente prévia/cópia. Clipboard só é alterado definitivamente quando você escolhe Copiar. A seleção é descartada da memória ao fechar ou após aplicar; respostas atrasadas de ações antigas são ignoradas.

## Configurar outro computador — botão no Metis

Em **Configurações → Configurações → Configurar ações de texto neste computador**, abra o assistente e clique em **Configurar neste Mac**. Ele mostra chave OpenAI presente/ausente (nunca o valor), Acessibilidade, atalho e quantidade de Serviços instalados. Apenas o campo do atalho é atualizado; outras preferências e chaves não são importadas/alteradas. Salve a chave no campo OpenAI se estiver ausente.

Após confirmação nativa, instala/atualiza somente três workflows gerenciados em `~/Library/Services`: **Traduzir com o Metis**, **Corrigir com o Metis** e **Reescrever com o Metis**. Em apps compatíveis, aparecem no botão direito → Serviços e devolvem o resultado diretamente ao editor. A visibilidade depende do app e da ativação em Teclado → Atalhos → Serviços. O botão para remover apaga somente workflows identificados como criados pelo Metis; arquivos de outros apps não são sobrescritos.

Essa integração exige **macOS 14+**. O pacote inclui auxiliar Swift universal (Apple Silicon + Intel), compilado pelo hook `beforePack`; em um Mac novo com app empacotado não exige instalar ferramentas de desenvolvimento. No dev, o botão pode compilar o auxiliar com Command Line Tools já instalado; não baixa ferramentas. Também existe `npm run text-services:build`.

O workflow envia texto por stdin ao auxiliar, que usa socket Unix privado (diretório 0700/socket 0600), com token local em configuração 0600. Não há texto selecionado/chave OpenAI em URLs, argumentos de processo ou arquivos de requisição. Somente Traduzir/Corrigir/Reescrever são aceitos, há limites de tamanho/concorrência, e erros não devolvem resultados parciais para sobrescrever o original. O auxiliar abre o Metis em segundo plano se necessário; esse início por Serviço não abre splash/janela, não solicita microfone e não inicia Dreaming. Não cria ícone no Dock/menu bar. O texto só sai do computador quando a ação chama a OpenAI configurada.

Acessibilidade/Automação continuam exigindo autorização do usuário para capturar/substituir em outros apps pelo atalho. O botão direito nos campos do próprio Metis/notas não depende dessas permissões. Os Serviços recebem/devolvem texto pelo macOS, sem simular teclado ou usar o clipboard global. Serviços, permissões e chave são locais a cada computador; a instalação não altera WritingTools.

## Validação

- Testes unitários cobrem erro de permissão retido, AX primeiro, fallback/clipboard, whitespace, limite, IDs expirados, janela/campo/texto alterados, descarte e handoff do atalho.
- Smoke com Electron/React reais e perfil temporário validou janela preenchida, erro legível, colagem manual, substituição direta (inclusive ação de contexto), cópia manual e resposta inicial atrasada. Usou somente texto de fixture, sem clipboard de usuário, IA real ou leitura de seleção de outro app.
- Smoke adicional do callback de atalho com Electron/React reais validou um painel não ativante e uma janela independente `#fields`: Traduzir/Corrigir/Reescrever alteraram apenas a seleção do editor original, sem qualquer acesso ao clipboard/Acessibilidade, foco na janela `#fields` ou abertura de outra janela. IA de fixture, sem chamadas reais.
- Smoke adicional em Electron real validou as três ações editando o trecho ORIGINAL dentro de textarea e editor rico, preservando o texto ao redor/outro campo, sem janela de resultado no sucesso. Também conferiu campo controlado por React após rerender e recusa quando o cursor mudou. A saída é texto literal, nunca HTML/código executável.
- Auxiliar Swift universal e workflow Automator foram executados com transformação/servidor de fixture e diretório temporário; devolveram texto sem instalar itens na Library do usuário ou chamar IA real. O botão do assistente foi testado no renderer Electron, incluindo salvar outras preferências sem desfazer o novo atalho.
- Aprovação da captura no app real continua necessária após liberar as permissões no macOS. A integração foi reimplementada no Metis, sem incorporar o código GPLv3 de WritingTools.
