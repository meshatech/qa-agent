export function toFriendlyLlmErrorMessage(rawMessage: string, statusCode?: number): string {
  if (statusCode === 429) {
    return 'Limite de requisicoes atingido no servico de IA. Aguarde um momento e tente novamente, ou configure um fallbackProvider alternativo.';
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'Chave de API invalida ou sem permissao. Verifique a variavel de ambiente configurada em llm.apiKeyEnv.';
  }
  if (statusCode && statusCode >= 500) {
    return 'O servico de IA esta temporariamente indisponivel. Tente novamente em alguns instantes.';
  }
  if (/fetch|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|network/i.test(rawMessage)) {
    return 'Nao foi possivel conectar ao servico de IA. Verifique sua conexao com a internet ou se a URL do provider esta acessivel.';
  }
  return 'Ocorreu um erro ao se comunicar com o servico de IA. Detalhe tecnico: ' + rawMessage;
}
