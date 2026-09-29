export function wantsFreshImage(text) {
  return /\b(nova imagem|imagem nova|do zero|comece do zero|outra imagem|sem relação|sem relacao|reinicie|recomece|novo desenho|nova foto)\b/i.test(
    String(text || "")
  );
}

export function shouldContinueImageContext(text, hasPreviousImage) {
  if (!hasPreviousImage) return false;
  const value = String(text || "").trim();
  if (!value) return true;
  if (wantsFreshImage(value)) return false;

  const explicitReference =
    /\b(essa|esta|nessa|nesta|dessa|desta|mesma|anterior|acima|última|ultima)\s+(imagem|foto|arte|imagem gerada|foto gerada)\b/i.test(value) ||
    /\b(nela|nessa imagem|na imagem|na foto|a partir dela|a partir dessa|use essa|use esta|mantenha essa)\b/i.test(value);

  const editLanguage =
    /\b(edite|editar|mude|mudar|troque|trocar|remova|remover|retire|tirar|apague|apagar|adicione|adicionar|coloque|colocar|deixe|deixar|melhore|melhorar|corrija|corrigir|transforme|transformar|preserve|manter|mantenha|aumente|reduza|fundo|rosto|cabelo|camisa|roupa|cor|objeto)\b/i.test(value);

  const explicitNewCreation =
    /\b(gere|gera|gerar|crie|cria|criar|faça|faca|desenhe|produza|generate|create|make|draw)\b[\s\S]{0,45}\b(uma|um)?\s*(nova\s+)?(imagem|foto|ilustração|ilustracao|desenho|arte)\b/i.test(value) ||
    /\b(gere|gera|crie|cria|faça|faca|desenhe|produza)\b[\s\S]{0,35}\b(de|do|da)\b/i.test(value);

  if (explicitReference || editLanguage) return true;
  if (explicitNewCreation) return false;

  return value.length <= 120;
}


export function selectImageChainHistory(
  messages,
  imageChainId,
  options = {}
) {
  const items = Array.isArray(messages) ? messages : [];
  const chainId = String(imageChainId || "");
  const max = Math.max(
    1,
    Math.min(24, Number(options.max || 12))
  );

  const usable = items.filter(
    (item) =>
      (item?.role === "user" || item?.role === "assistant") &&
      typeof item?.content === "string" &&
      item.content.trim()
  );

  if (chainId) {
    const sameChain = usable.filter(
      (item) => String(item?.imageChainId || "") === chainId
    );
    if (sameChain.length) {
      return sameChain
        .slice(-max)
        .map((item) => ({
          role: item.role,
          content: item.content,
        }));
    }
  }

  if (options.legacyContinuation) {
    return usable
      .filter(
        (item) =>
          item?.mode === "image" ||
          item?.media?.type === "image" ||
          Boolean(item?.imageTask) ||
          /^image|^visual|edit|poster|enhance|background|identity/i.test(
            String(item?.generationMode || "")
          )
      )
      .slice(-Math.min(max, 6))
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));
  }

  return [];
}
