/* =============================================================
   ADMIN — USUÁRIOS DO PAINEL (somente gerente)
============================================================= */

const $usuario = id => document.getElementById(id);

let usuarios = [];


async function carregarUsuarios() {

  try {

    usuarios = await adminApi('/admin/usuarios');
    const logado = lerAdminSalvo();

    $usuario('usuarios-lista').innerHTML = usuarios.map(u => `
      <tr>
        <td><strong>${escaparHtmlPainel(u.nome)}</strong>${logado && logado.id === u.id ? ' <small class="admin-muted-text">(você)</small>' : ''}<br>
          <span class="admin-muted-text">${escaparHtmlPainel(u.email)}</span></td>
        <td>${u.perfil === 'gerente' ? 'Gerente' : 'Operador'}</td>
        <td>${Number(u.ativo)
          ? '<span class="pedido-status-badge status-pago">Ativo</span>'
          : '<span class="pedido-status-badge status-padrao">Inativo</span>'}</td>
        <td>${dataPainel(u.ultimo_login_em, true)}</td>
        <td class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn btn-sm btn-outline-light" data-editar="${Number(u.id)}">Editar</button>
          <button type="button" class="btn btn-sm btn-outline-warning" data-senha="${Number(u.id)}">Redefinir senha</button>
        </td>
      </tr>`).join('');

  } catch (erro) {
    $usuario('usuario-mensagem').textContent = erro.message;
  }
}


function preencherUsuario(usuario = null) {

  $usuario('usuario-form-titulo').textContent = usuario ? `Editar ${usuario.nome}` : 'Novo usuário';
  $usuario('usuario-id').value = usuario ? usuario.id : '';
  $usuario('usuario-nome').value = usuario?.nome || '';
  $usuario('usuario-email').value = usuario?.email || '';
  $usuario('usuario-email').disabled = Boolean(usuario);
  $usuario('usuario-perfil').value = usuario?.perfil || 'operador';
  $usuario('usuario-ativo').checked = usuario ? Boolean(Number(usuario.ativo)) : true;
  $usuario('usuario-senha').value = '';
  $usuario('usuario-senha-grupo').hidden = Boolean(usuario);
  $usuario('usuario-mensagem').textContent = '';
}


$usuario('usuarios-lista').addEventListener('click', async evento => {

  const editar = evento.target.closest('[data-editar]');
  const senha = evento.target.closest('[data-senha]');

  if (editar) {
    preencherUsuario(usuarios.find(u => u.id === Number(editar.dataset.editar)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (senha) {

    const nova = window.prompt('Nova senha (mínimo 8 caracteres, com letras e números):');
    if (!nova) return;

    try {
      const resposta = await adminApi(`/admin/usuarios/${Number(senha.dataset.senha)}/senha`, {
        metodo: 'PATCH',
        corpo: { senha: nova }
      });
      alert(resposta.mensagem);
    } catch (erro) {
      alert(erro.message);
    }
  }
});


$usuario('usuario-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const id = $usuario('usuario-id').value;
  const saida = $usuario('usuario-mensagem');

  const corpo = {
    nome: $usuario('usuario-nome').value.trim(),
    perfil: $usuario('usuario-perfil').value,
    ativo: $usuario('usuario-ativo').checked
  };

  if (!id) {
    corpo.email = $usuario('usuario-email').value.trim();
    corpo.senha = $usuario('usuario-senha').value;
  }

  try {
    await adminApi(id ? `/admin/usuarios/${id}` : '/admin/usuarios', {
      metodo: id ? 'PUT' : 'POST',
      corpo
    });
    preencherUsuario();
    saida.textContent = 'Usuário salvo.';
    await carregarUsuarios();
  } catch (erro) {
    saida.textContent = erro.message;
  }
});

$usuario('usuario-limpar').addEventListener('click', () => preencherUsuario());


$usuario('minha-senha-form').addEventListener('submit', async evento => {

  evento.preventDefault();

  const saida = $usuario('minha-senha-mensagem');

  try {

    const resposta = await adminApi('/admin/me/senha', {
      metodo: 'PATCH',
      corpo: {
        senha_atual: $usuario('minha-senha-atual').value,
        senha_nova: $usuario('minha-senha-nova').value
      }
    });

    // O token anterior foi invalidado: guarda o novo
    sessionStorage.setItem(ADMIN_TOKEN_KEY, resposta.token);
    evento.target.reset();
    saida.textContent = resposta.mensagem;

  } catch (erro) {
    saida.textContent = erro.message;
  }
});


// Operador não tem acesso a esta tela
const adminLogado = lerAdminSalvo();

if (adminLogado && adminLogado.perfil !== 'gerente') {
  window.location.href = 'dashboard.html';
} else {
  carregarUsuarios();
}
