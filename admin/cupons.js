/* =============================================================
   ADMIN — CUPONS
============================================================= */

const $cupom = id => document.getElementById(id);

let cuponsCadastrados = [];


function descreverDesconto(cupom) {
  if (cupom.tipo === 'percentual') return `${Number(cupom.valor)}%`;
  if (cupom.tipo === 'fixo') return moedaPainel(cupom.valor);
  return 'Frete grátis';
}


function descreverRegras(cupom) {

  const regras = [];

  if (cupom.valor_minimo != null) regras.push(`Mínimo ${moedaPainel(cupom.valor_minimo)}`);
  if (cupom.limite_por_cliente != null) regras.push(`${Number(cupom.limite_por_cliente)}x por cliente`);

  return regras.length ? regras.join('<br>') : '—';
}


function descreverValidade(cupom) {

  if (!cupom.inicio_em && !cupom.fim_em) return 'Sem prazo';

  const expirado = cupom.fim_em && new Date(cupom.fim_em) < new Date();

  return `${cupom.inicio_em ? `De ${dataPainel(cupom.inicio_em, true)}<br>` : ''}` +
    `${cupom.fim_em ? `Até ${dataPainel(cupom.fim_em, true)}` : ''}` +
    `${expirado ? '<br><span class="text-danger">Expirado</span>' : ''}`;
}


async function carregarCupons() {

  try {

    cuponsCadastrados = await adminApi('/admin/cupons');

    $cupom('cupons-lista').innerHTML = cuponsCadastrados.length === 0
      ? '<tr><td colspan="7" class="admin-muted-text">Nenhum cupom cadastrado.</td></tr>'
      : cuponsCadastrados.map(cupom => `
        <tr>
          <td><strong>${escaparHtmlPainel(cupom.codigo)}</strong><br>
            <span class="admin-muted-text">${escaparHtmlPainel(cupom.descricao || '')}</span></td>
          <td>${descreverDesconto(cupom)}</td>
          <td>${descreverRegras(cupom)}</td>
          <td>${descreverValidade(cupom)}</td>
          <td>${Number(cupom.usos)}${cupom.limite_uso_total != null ? ` / ${Number(cupom.limite_uso_total)}` : ''}</td>
          <td>${Number(cupom.ativo)
            ? '<span class="pedido-status-badge status-pago">Ativo</span>'
            : '<span class="pedido-status-badge status-padrao">Inativo</span>'}</td>
          <td><button type="button" class="btn btn-sm btn-outline-light" data-editar="${Number(cupom.id)}">Editar</button></td>
        </tr>`).join('');

  } catch (erro) {
    $cupom('cupom-mensagem').textContent = erro.message;
  }
}


function ajustarCampoValor() {
  const tipo = $cupom('cupom-tipo').value;
  $cupom('cupom-valor').disabled = tipo === 'frete_gratis';
  $cupom('cupom-valor').placeholder = tipo === 'percentual' ? '10' : (tipo === 'fixo' ? '20,00' : '—');
}

$cupom('cupom-tipo').addEventListener('change', ajustarCampoValor);


function preencherCupom(cupom = null) {

  $cupom('cupom-form-titulo').textContent = cupom ? `Editar cupom ${cupom.codigo}` : 'Novo cupom';
  $cupom('cupom-id').value = cupom ? cupom.id : '';
  $cupom('cupom-codigo').value = cupom?.codigo || '';
  $cupom('cupom-tipo').value = cupom?.tipo || 'percentual';
  $cupom('cupom-valor').value = cupom && cupom.tipo !== 'frete_gratis' ? Number(cupom.valor) : '';
  $cupom('cupom-descricao').value = cupom?.descricao || '';
  $cupom('cupom-minimo').value = cupom?.valor_minimo != null ? Number(cupom.valor_minimo) : '';
  $cupom('cupom-inicio').value = paraCampoDataHora(cupom?.inicio_em);
  $cupom('cupom-fim').value = paraCampoDataHora(cupom?.fim_em);
  $cupom('cupom-limite-total').value = cupom?.limite_uso_total ?? '';
  $cupom('cupom-limite-cliente').value = cupom?.limite_por_cliente ?? '';
  $cupom('cupom-ativo').checked = cupom ? Boolean(Number(cupom.ativo)) : true;
  $cupom('cupom-mensagem').textContent = '';

  ajustarCampoValor();
}


$cupom('cupons-lista').addEventListener('click', evento => {
  const botao = evento.target.closest('[data-editar]');
  if (botao) {
    preencherCupom(cuponsCadastrados.find(c => c.id === Number(botao.dataset.editar)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});


$cupom('cupom-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const id = $cupom('cupom-id').value;
  const saida = $cupom('cupom-mensagem');

  const corpo = {
    codigo: $cupom('cupom-codigo').value.trim(),
    tipo: $cupom('cupom-tipo').value,
    valor: numeroOpcional($cupom('cupom-valor').value),
    descricao: $cupom('cupom-descricao').value.trim() || undefined,
    valor_minimo: numeroOpcional($cupom('cupom-minimo').value),
    inicio_em: deCampoDataHora($cupom('cupom-inicio').value),
    fim_em: deCampoDataHora($cupom('cupom-fim').value),
    limite_uso_total: numeroOpcional($cupom('cupom-limite-total').value),
    limite_por_cliente: numeroOpcional($cupom('cupom-limite-cliente').value),
    ativo: $cupom('cupom-ativo').checked
  };

  try {
    await adminApi(id ? `/admin/cupons/${id}` : '/admin/cupons', {
      metodo: id ? 'PUT' : 'POST',
      corpo
    });
    preencherCupom();
    saida.textContent = 'Cupom salvo.';
    await carregarCupons();
  } catch (erro) {
    saida.textContent = erro.message;
  }
});

$cupom('cupom-limpar').addEventListener('click', () => preencherCupom());


ajustarCampoValor();
carregarCupons();
