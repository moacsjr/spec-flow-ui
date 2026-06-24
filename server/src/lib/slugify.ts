// Converte o título de uma issue ("[FEATURE] Cadastro de Pedidos com PIX") no slug
// de diretório usado pelo spec-flow (`docs/features/<slug>/`). Portado de
// spec-flow/.../src/lib/slugify.mjs — deve gerar exatamente o mesmo slug, para que
// o app localize o plan.md no repositório.
export function slugify(title: string): string {
  return title
    .replace(/^\[.*?\]\s*/, '') // remove o prefixo [TIPO]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (combining marks)
    .replace(/[^a-z0-9\s-]/g, '') // remove não-alfanuméricos
    .trim()
    .replace(/\s+/g, '-') // espaços → hífens
    .replace(/-+/g, '-'); // colapsa hífens repetidos
}
