/* =============================================================
   ADMIN — CATEGORIAS
============================================================= */

const $categoria = id => document.getElementById(id);

// Sugestão para começar uma loja nova
const CATEGORIAS_PADRAO = ['Camisetas', 'Moletons', 'Calças', 'Bonés', 'Acessórios'];

let categorias = [];


async function carregarCategorias() {

  try {

    categorias = await adminApi('/admin/categorias');

    $categoria('categoria-lista').innerHTML = categorias.length === 0
      ? '<tr><td colspan="3" class="admin-muted-text">Nenhuma categoria. Cadastre ao menos uma para criar produtos.</td></tr>'
      : categorias.map(categoria => `
        <tr>
          <td>${escaparHtmlPainel(categoria.nome)}</td>
          <td>${Number(categoria.ativo)
            ? '<span class="pedido-status-badge status-pago">Ativa</span>'
            : '<span class="pedido-status-badge status-padrao">Inativa</span>'}</td>
          <td class="d-flex gap-2">
            <button type="button" class="btn btn-sm btn-outline-light" data-editar="${Number(categoria.id)}">Renomear</button>
            ${Number(categoria.ativo)
              ? `<button type="button" class="btn btn-sm btn-outline-danger" data-desativar="${Number(categoria.id)}">Desativar</button>`
              : `<button type="button" class="btn btn-sm btn-outline-light" data-reativar="${Number(categoria.id)}">Reativar</button>`}
          </td>
        </tr>`).join('');

    const faltando = CATEGORIAS_PADRAO.filter(nome => !existe(nome));
    $categoria('categorias-padrao').hidden = faltando.length === 0;

  } catch (erro) {
    $categoria('categoria-mensagem').textContent = erro.message;
  }
}


function existe(nome) {
  const alvo = nome.toLocaleLowerCase('pt-BR');
  return categorias.some(c => c.nome.toLocaleLowerCase('pt-BR') === alvo);
}


function preencherFormulario(categoria = null) {

  $categoria('categoria-form-titulo').textContent = categoria
    ? `Renomear: ${categoria.nome}`
    : 'Nova categoria';
  $categoria('categoria-id').value = categoria ? categoria.id : '';
  $categoria('categoria-nome').value = categoria?.nome || '';
  $categoria('categoria-mensagem').textContent = '';

  if (categoria) {
    $categoria('categoria-nome').focus();
  }
}


$categoria('categoria-lista').addEventListener('click', async evento => {

  const editar = evento.target.closest('[data-editar]');
  const desativar = evento.target.closest('[data-desativar]');
  const reativar = evento.target.closest('[data-reativar]');

  try {

    if (editar) {
      preencherFormulario(categorias.find(c => c.id === Number(editar.dataset.editar)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (desativar && confirm('Desativar esta categoria? Ela some da loja e do cadastro de produtos.')) {
      await adminApi(`/categorias/${Number(desativar.dataset.desativar)}`, { metodo: 'DELETE' });
      await carregarCategorias();
    }

    if (reativar) {
      await adminApi(`/categorias/${Number(reativar.dataset.reativar)}/reativar`, { metodo: 'PATCH' });
      await carregarCategorias();
    }

  } catch (erro) {
    alert(erro.message);
  }
});


$categoria('categoria-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const id = $categoria('categoria-id').value;
  const nome = $categoria('categoria-nome').value.trim();
  const saida = $categoria('categoria-mensagem');

  if (!nome) {
    saida.textContent = 'Informe o nome da categoria.';
    return;
  }

  try {
    await adminApi(id ? `/categorias/${id}` : '/categorias', {
      metodo: id ? 'PUT' : 'POST',
      corpo: { nome }
    });
    preencherFormulario();
    saida.textContent = 'Categoria salva.';
    await carregarCategorias();
  } catch (erro) {
    saida.textContent = erro.message;
  }
});

$categoria('categoria-limpar').addEventListener('click', () => preencherFormulario());


$categoria('categorias-padrao').addEventListener('click', async () => {

  const faltando = CATEGORIAS_PADRAO.filter(nome => !existe(nome));
  const saida = $categoria('categoria-mensagem');

  if (!confirm(`Criar: ${faltando.join(', ')}?`)) {
    return;
  }

  const erros = [];

  for (const nome of faltando) {
    try {
      await adminApi('/categorias', { metodo: 'POST', corpo: { nome } });
    } catch (erro) {
      erros.push(`${nome}: ${erro.message}`);
    }
  }

  saida.textContent = erros.length
    ? `Algumas não foram criadas. ${erros.join(' | ')}`
    : 'Categorias padrão criadas.';

  await carregarCategorias();
});


carregarCategorias();
