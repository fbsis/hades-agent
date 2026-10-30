# Ações de texto no macOS

Selecione um trecho em outro app e use **Option+Espaço**, padrão do WritingTools para Mac e novo padrão do Metis. Instalações antigas mantêm o atalho salvo; ajuste em Configurações → Teclas de Atalho. O perfil de desenvolvimento foi migrado somente nesse campo, preservando Option+D e as demais preferências.

Se WritingTools/outro app ocupar esse atalho, o Metis aguarda sua liberação e tenta registrar novamente a cada 5 segundos, sem remover os outros atalhos nem alterar/fechar o outro aplicativo. Pause os hotkeys ou encerre WritingTools para usar a mesma combinação no Metis. A configuração pessoal de WritingTools não foi importada: o macOS protegeu o arquivo de preferências, e não tentamos contornar a proteção.

## Captura e janela

- A captura tenta ler a seleção pela Acessibilidade antes de recorrer a copiar/colar. O fallback espera os modificadores serem soltos e restaura os formatos conhecidos de clipboard (texto, HTML, RTF e imagem); não há garantia sobre formatos proprietários/gerenciadores externos.
- O dev (`Electron/Metis Dev`) precisa de suas próprias permissões em **Privacidade e Segurança → Acessibilidade** e **Automação → System Events**. Permissões do Metis instalado ou do WritingTools não são transferidas. O painel oferece botão para abrir a seção correspondente; não concede permissão automaticamente.
- Sucesso e erro ficam em memória no processo principal para o renderer buscá-los, mesmo quando o módulo React carrega depois do evento. Uma resposta inicial atrasada não pode apagar uma seleção mais recente.
- A janela tem fundo opaco, tamanho ajustável, carregamento explícito e fallback de falha de renderização. Nunca depende de uma área transparente vazia para explicar erros.
- Sem seleção/permissão, o campo **Texto selecionado** continua disponível para colar manualmente. A transformação funciona com esse texto, mas não há substituição automática em um app desconhecido.

## Transformação e aplicação

Escolha Corrigir, Reescrever, Traduzir, etc., ou uma instrução personalizada. Só essa ação envia texto à OpenAI já configurada; não depende de `work.home`, nem cria histórico/aprendizado automaticamente. A chave deve existir no perfil usado e o provedor exige internet/acesso ao modelo.

Todo resultado aparece primeiro em **prévia editável**, sem alterar o app original. Use **Copiar** ou **Substituir seleção**. Substituição só é oferecida para origem reconhecida como editável, não para terminais ou seleção truncada acima de 30 mil caracteres. Ela confere ID da seleção, processo, janela, campo identificado e texto ainda selecionado antes de colar; se mudou, recusa e mantém o resultado para copiar. Não há garantia universal para editores com APIs de acessibilidade incompletas.

A substituição é de **texto simples**, não preserva automaticamente estilos RTF/negrito/links do documento. Resumir/Explicar são somente prévia/cópia. Clipboard só é alterado definitivamente quando você escolhe Copiar. A seleção é descartada da memória ao fechar ou após aplicar; respostas atrasadas de ações antigas são ignoradas.

## Validação

- Testes unitários cobrem erro de permissão retido, AX primeiro, fallback/clipboard, whitespace, limite, IDs expirados, janela/campo/texto alterados, descarte e handoff do atalho.
- Smoke com Electron/React reais e perfil temporário validou janela preenchida, erro legível, colagem manual, transformação em prévia, confirmação para substituir e resposta inicial atrasada. Usou somente texto de fixture, sem clipboard de usuário, IA real ou leitura de seleção de outro app.
- Aprovação da captura no app real continua necessária após liberar as permissões no macOS. A integração foi reimplementada no Metis, sem incorporar o código GPLv3 de WritingTools.
