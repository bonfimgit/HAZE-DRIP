const ADMIN_TOKEN_KEY =
  'hazeAdminToken';


const ADMIN_USER_KEY =
  'hazeAdmin';



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

function carregarAdminLogado() {

  const adminSalvo =
  sessionStorage.getItem(
    ADMIN_USER_KEY
  );


if (
  !adminSalvo ||
  adminSalvo === 'undefined' ||
  adminSalvo === 'null'
) {

  return;

}


  try {

    const admin =
      JSON.parse(adminSalvo);


    document
      .querySelectorAll(
        '.js-admin-nome'
      )
      .forEach(elemento => {

        elemento.textContent =
          admin.nome ||
          'Gerente';

      });


    document
      .querySelectorAll(
        '.js-admin-perfil'
      )
      .forEach(elemento => {

        elemento.textContent =
          admin.perfil ||
          'Gerente';

      });


  } catch (erro) {

    console.error(
      'Erro ao carregar administrador:',
      erro
    );

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
   INICIALIZAÇÃO
============================================================= */

if (verificarLoginAdmin()) {

  carregarAdminLogado();


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

}