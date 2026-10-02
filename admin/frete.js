/* =============================================================
   ADMIN — REGRAS DE FRETE
============================================================= */

const $frete = id => document.getElementById(id);

let regrasFrete = [];


function formatarCep(cep) {
  return cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '';
}


function abrangencia(regra) {
  if (regra.cep_inicio) return `CEP ${formatarCep(regra.cep_inicio)} a ${formatarCep(regra.cep_fim)}`;
  if (regra.uf) return `Estado: ${escaparHtmlPainel(regra.uf)}`;
  return 'Todo o Brasil (padrão)';
}


async function carregarFrete() {

  try {

    regrasFrete = await adminApi('/admin/frete');

    $frete('frete-lista').innerHTML = regrasFrete.length === 0
      ? '<tr><td colspan="7" class="admin-muted-text">Nenhuma regra. Sem regra, o checkout não calcula frete.</td></tr>'
      : regrasFrete.map(regra => `
        <tr>
          <td>${escaparHtmlPainel(regra.nome)}</td>
          <td>${abrangencia(regra)}</td>
          <td>${moedaPainel(regra.valor)}</td>
          <td>${Number(regra.prazo_min_dias)} a ${Number(regra.prazo_max_dias)} dias</td>
          <td>${regra.gratis_acima != null ? moedaPainel(regra.gratis_acima) : '—'}</td>
          <td>${Number(regra.ativo)
            ? '<span class="pedido-status-badge status-pago">Ativa</span>'
            : '<span class="pedido-status-badge status-padrao">Inativa</span>'}</td>
          <td class="d-flex gap-2">
            <button type="button" class="btn btn-sm btn-outline-light" data-editar="${Number(regra.id)}">Editar</button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-remover="${Number(regra.id)}">Remover</button>
          </td>
        </tr>`).join('');

  } catch (erro) {
    $frete('frete-mensagem').textContent = erro.message;
  }
}


function preencherFormulario(regra = null) {

  $frete('frete-form-titulo').textContent = regra ? `Editar regra: ${regra.nome}` : 'Nova regra';
  $frete('frete-id').value = regra ? regra.id : '';
  $frete('frete-nome').value = regra?.nome || '';
  $frete('frete-uf').value = regra?.uf || '';
  $frete('frete-cep-inicio').value = formatarCep(regra?.cep_inicio);
  $frete('frete-cep-fim').value = formatarCep(regra?.cep_fim);
  $frete('frete-valor').value = regra ? Number(regra.valor) : '';
  $frete('frete-prazo-min').value = regra ? regra.prazo_min_dias : '';
  $frete('frete-prazo-max').value = regra ? regra.prazo_max_dias : '';
  $frete('frete-gratis').value = regra?.gratis_acima != null ? Number(regra.gratis_acima) : '';
  $frete('frete-ativo').checked = regra ? Boolean(Number(regra.ativo)) : true;
  $frete('frete-mensagem').textContent = '';

  if (regra) {
    $frete('frete-nome').focus();
  }
}


$frete('frete-lista').addEventListener('click', async evento => {

  const editar = evento.target.closest('[data-editar]');
  const remover = evento.target.closest('[data-remover]');

  if (editar) {
    preencherFormulario(regrasFrete.find(r => r.id === Number(editar.dataset.editar)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (remover && confirm('Remover esta regra de frete?')) {
    try {
      await adminApi(`/admin/frete/${Number(remover.dataset.remover)}`, { metodo: 'DELETE' });
      await carregarFrete();
    } catch (erro) {
      alert(erro.message);
    }
  }
});


$frete('frete-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const id = $frete('frete-id').value;
  const saida = $frete('frete-mensagem');

  const corpo = {
    nome: $frete('frete-nome').value.trim(),
    uf: $frete('frete-uf').value.trim() || undefined,
    cep_inicio: $frete('frete-cep-inicio').value.trim() || undefined,
    cep_fim: $frete('frete-cep-fim').value.trim() || undefined,
    valor: numeroOpcional($frete('frete-valor').value),
    prazo_min_dias: numeroOpcional($frete('frete-prazo-min').value),
    prazo_max_dias: numeroOpcional($frete('frete-prazo-max').value),
    gratis_acima: numeroOpcional($frete('frete-gratis').value),
    ativo: $frete('frete-ativo').checked
  };

  try {
    await adminApi(id ? `/admin/frete/${id}` : '/admin/frete', {
      metodo: id ? 'PUT' : 'POST',
      corpo
    });
    preencherFormulario();
    saida.textContent = 'Regra salva.';
    await carregarFrete();
  } catch (erro) {
    saida.textContent = erro.message;
  }
});

$frete('frete-limpar').addEventListener('click', () => preencherFormulario());


$frete('frete-simulador').addEventListener('submit', async evento => {

  evento.preventDefault();

  const saida = $frete('simular-resultado');
  const parametros = new URLSearchParams({ cep: $frete('simular-cep').value.trim() });

  if ($frete('simular-uf').value.trim()) parametros.set('uf', $frete('simular-uf').value.trim());
  if ($frete('simular-valor').value) parametros.set('valor', $frete('simular-valor').value);

  try {
    const frete = await adminApi(`/admin/frete/simular?${parametros}`);
    saida.textContent =
      `Regra "${frete.descricao}": ${frete.gratis ? 'grátis' : moedaPainel(frete.valor)}, ` +
      `${frete.prazo_min_dias} a ${frete.prazo_max_dias} dias úteis.`;
  } catch (erro) {
    saida.textContent = erro.message;
  }
});


carregarFrete();
