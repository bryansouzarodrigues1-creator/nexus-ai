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
