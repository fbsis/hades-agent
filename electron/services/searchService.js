const axios = require('axios');
const jsonStore = require('../store/jsonStore');

class SearchService {
    async searchWeb(query) {
        try {
            // Primeiro verifica as configurações salvas, depois a variável de ambiente
            const apiKey = jsonStore.getSettings()?.general?.tavilyApiKey || process.env.VITE_TAVILY_API_KEY; 
            
            if (!apiKey) {
                return "Erro: A chave da API do Tavily não está configurada. Por favor, configure-a nas Configurações do Metis (Alt+S).";
            }

            console.log(`[SearchService] Buscando via Tavily: ${query}`);
            
            const response = await axios.post('https://api.tavily.com/search', {
                api_key: apiKey,
                query: query,
                search_depth: "basic",
                include_answer: true,
                max_results: 5,
            });

            if (response.data && response.data.results) {
                const resultsText = response.data.results
                    .map(r => `[${r.title}](${r.url})\n${r.content}`)
                    .join('\n\n');
                
                const answer = response.data.answer ? `\nResumo da Web: ${response.data.answer}\n\n` : '';
                return `${answer}Resultados Encontrados:\n${resultsText}`;
            }

            return "Nenhum resultado encontrado.";
        } catch (error) {
            console.error("[SearchService] Erro na busca Tavily:", error.message);
            return `Erro ao buscar na web via Tavily: ${error.response?.data?.error || error.message}`;
        }
    }
}

module.exports = new SearchService();
