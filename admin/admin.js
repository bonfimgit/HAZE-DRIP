const ADMIN_TOKEN_KEY =
  'hazeAdminToken';


const ADMIN_USER_KEY =
  'hazeAdmin';



/* =============================================================
   MENU DO PAINEL
   -------------------------------------------------------------
   Lista única de páginas. O menu de todas as telas é montado a
   partir daqui, então uma página nova só precisa entrar nesta lista.
   "somenteGerente" esconde o link para o perfil operador.
============================================================= */

const ADMIN_MENU = [
  { href: 'dashboard.html', texto: 'Dashboard' },
  { href: 'pedidos.html', texto: 'Pedidos', relacionados: ['pedido-detalhes.html'] },
  { href: 'produtos.html', texto: 'Produtos', relacionados: ['produto-novo.html', 'produto-editar.html', 'produto-fotos.html', 'produto-variacoes.html'] },
  { href: 'estoque.html', texto: 'Estoque' },
  { href: 'clientes.html', texto: 'Clientes', relacionados: ['cliente-detalhes.html'] },
  { href: 'cupons.html', texto: 'Cupons' },
  { href: 'frete.html', texto: 'Frete' },
  { href: 'drops.html', texto: 'Drops' },
  { href: 'campanha.html', texto: 'Campanha' },
  { href: 'relatorios.html', texto: 'Relatórios', somenteGerente: true },
  { href: 'usuarios.html', texto: 'Usuários', somenteGerente: true }
];



/* =============================================================
   PROTEGER ÁREA ADMINISTRATIVA
============================================================= */

function verificarLoginAdmin() {

  const token =
    sessionStorage.getItem(
      ADMIN_TOKEN_KEY
    );


  if (!token) {

    window.location.href =
      'login.html';

    return false;

  }


  return true;

}



/* =============================================================
   DADOS DO GERENTE
============================================================= */

function lerAdminSalvo() {

  const adminSalvo =
    sessionStorage.getItem(
      ADMIN_USER_KEY
    );

  if (
    !adminSalvo ||
    adminSalvo === 'undefined' ||
    adminSalvo === 'null'
  ) {
    return null;
  }

  try {
    return JSON.parse(adminSalvo);
  } catch {
    return null;
  }

}


function carregarAdminLogado() {

  const admin = lerAdminSalvo();

  if (!admin) {
    return;
  }

  document
    .querySelectorAll('.js-admin-nome')
    .forEach(elemento => {
      elemento.textContent = admin.nome || 'Gerente';
    });

  document
    .querySelectorAll('.js-admin-perfil')
    .forEach(elemento => {
      elemento.textContent =
        admin.perfil === 'operador' ? 'Operador' : 'Gerente';
    });

}



/* =============================================================
   MONTAR MENU
============================================================= */

function montarMenuAdmin() {

  const paginaAtual =
    window.location.pathname.split('/').pop() || 'dashboard.html';

  const admin = lerAdminSalvo();
  const ehGerente = !admin || admin.perfil !== 'operador';

  const itens = ADMIN_MENU.filter(item => ehGerente || !item.somenteGerente);

  function ativo(item) {
    return item.href === paginaAtual ||
      (item.relacionados || []).includes(paginaAtual);
  }

  // Layout principal (admin.css)
  const menuPrincipal = document.querySelector('.admin-menu');

  if (menuPrincipal) {
    menuPrincipal.innerHTML = itens.map(item => `
      <a href="${item.href}" class="admin-menu-link${ativo(item) ? ' active' : ''}"${ativo(item) ? ' aria-current="page"' : ''}>
        ${item.texto}
      </a>`).join('');
  }

  // Layout das telas de pedidos/clientes (pedidos.css)
  const menuSecundario = document.querySelector('.admin-nav');

  if (menuSecundario) {

    menuSecundario.innerHTML = itens.map(item => `
      <a href="${item.href}"${ativo(item) ? ' class="active" aria-current="page"' : ''}>
        ${item.texto}
      </a>`).join('');

    // Essas telas não tinham botão de sair
    const sidebar = menuSecundario.closest('.admin-sidebar');

    if (sidebar && !sidebar.querySelector('.js-admin-sair')) {
      const sair = document.createElement('button');
      sair.type = 'button';
      sair.className = 'admin-logout js-admin-sair';
      sair.textContent = 'Sair';
      sidebar.appendChild(sair);
    }
  }

}



/* =============================================================
   LOGOUT
============================================================= */

function sairAdmin() {

  sessionStorage.removeItem(
    ADMIN_TOKEN_KEY
  );


  sessionStorage.removeItem(
    ADMIN_USER_KEY
  );


  window.location.href =
    'login.html';

}



/* =============================================================
   REQUISIÇÕES AUTENTICADAS
   -------------------------------------------------------------
   adminApi('/admin/clientes')
   adminApi('/admin/cupons', { metodo: 'POST', corpo: {...} })
   Redireciona para o login quando a sessão expira.
============================================================= */

async function adminApi(caminho, { metodo = 'GET', corpo } = {}) {

  const headers = {
    Authorization: `Bearer ${sessionStorage.getItem(ADMIN_TOKEN_KEY)}`
  };

  if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const resposta = await fetch(`${HAZE_API_URL}${caminho}`, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });

  if (resposta.status === 401) {
    sairAdmin();
    throw new Error('Sessão expirada.');
  }

  let dados = null;

  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    throw new Error(
      dados?.mensagem || dados?.erro || `Erro HTTP ${resposta.status}`
    );
  }

  return dados;
}


// Escapa textos antes de inserir em innerHTML
function escaparHtmlPainel(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function moedaPainel(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}


function dataPainel(valor, comHora = false) {
  if (!valor) return '—';
  const data = new Date(valor);
  return comHora
    ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : data.toLocaleDateString('pt-BR');
}



// Converte data da API para o valor de <input type="datetime-local">
function paraCampoDataHora(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// Valor de <input type="datetime-local"> para ISO (ou undefined)
function deCampoDataHora(valor) {
  return valor ? new Date(valor).toISOString() : undefined;
}

// Número opcional de um campo (vazio = undefined)
function numeroOpcional(valor) {
  return valor === '' || valor == null ? undefined : Number(valor);
}


const STATUS_PEDIDO = {
  aguardando_pagamento: { nome: 'Aguardando pagamento', classe: 'status-aguardando' },
  pago: { nome: 'Pago', classe: 'status-pago' },
  em_preparacao: { nome: 'Em preparação', classe: 'status-preparacao' },
  enviado: { nome: 'Enviado', classe: 'status-enviado' },
  entregue: { nome: 'Entregue', classe: 'status-entregue' },
  cancelado: { nome: 'Cancelado', classe: 'status-cancelado' }
};


function seloStatusPedido(status) {
  const info = STATUS_PEDIDO[status] || { nome: status, classe: 'status-padrao' };
  return `<span class="pedido-status-badge ${info.classe}">${escaparHtmlPainel(info.nome)}</span>`;
}



/* =============================================================
   INICIALIZAÇÃO
============================================================= */

if (verificarLoginAdmin()) {

  carregarAdminLogado();

  montarMenuAdmin();


  document
    .querySelectorAll(
      '.js-admin-sair'
    )
    .forEach(botao => {

      botao.addEventListener(
        'click',
        sairAdmin
      );

    });


  // Atualiza nome/perfil e confirma que a sessão continua válida
  adminApi('/admin/me')
    .then(admin => {
      sessionStorage.setItem(ADMIN_USER_KEY, JSON.stringify(admin));
      carregarAdminLogado();
      montarMenuAdmin();
      document
        .querySelectorAll('.js-admin-sair')
        .forEach(botao => botao.addEventListener('click', sairAdmin));
    })
    .catch(() => {});

}
