const API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


const formulario =
  document.getElementById(
    'admin-login-form'
  );


const campoEmail =
  document.getElementById(
    'admin-email'
  );


const campoSenha =
  document.getElementById(
    'admin-senha'
  );


const botaoEntrar =
  document.getElementById(
    'admin-login-btn'
  );


const mensagemErro =
  document.getElementById(
    'admin-login-erro'
  );


const botaoVerSenha =
  document.getElementById(
    'admin-ver-senha'
  );



/* =============================================================
   MOSTRAR / ESCONDER SENHA
============================================================= */

if (
  botaoVerSenha &&
  campoSenha
) {

  botaoVerSenha.addEventListener(
    'click',
    () => {

      const mostrando =
        campoSenha.type === 'text';


      campoSenha.type =
        mostrando
          ? 'password'
          : 'text';


      botaoVerSenha.textContent =
        mostrando
          ? '👁'
          : '✕';

    }
  );

}



/* =============================================================
   LOGIN ADMIN
============================================================= */

if (formulario) {

  formulario.addEventListener(
    'submit',
    async (evento) => {

      evento.preventDefault();


      mensagemErro.textContent = '';


      const email =
        campoEmail.value
          .trim()
          .toLowerCase();


      const senha =
        campoSenha.value;


      if (!email || !senha) {

        mensagemErro.textContent =
          'Preencha e-mail e senha.';

        return;

      }


      try {

        botaoEntrar.disabled = true;

        botaoEntrar.textContent =
          'ENTRANDO...';


        const resposta = await fetch(
          `${API_URL}/admin/login`,
          {

            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              email,
              senha
            })

          }
        );


        const resultado =
          await resposta.json();


        if (!resposta.ok) {

          throw new Error(
            resultado.erro ||
            resultado.mensagem ||
            'E-mail ou senha inválidos.'
          );

        }


        if (!resultado.token) {

          throw new Error(
            'Token de acesso não recebido.'
          );

        }


        /*
          Guardamos o JWT somente durante
          a sessão atual do navegador.
        */

        sessionStorage.setItem(
          'hazeAdminToken',
          resultado.token
        );


        sessionStorage.setItem(
          'hazeAdmin',
          JSON.stringify(
            resultado.admin
          )
        );


        window.location.href =
          'dashboard.html';


      } catch (erro) {

        console.error(
          'Erro no login:',
          erro
        );


        mensagemErro.textContent =
          erro.message ||
          'Não foi possível entrar.';


        botaoEntrar.disabled = false;

        botaoEntrar.textContent =
          'ENTRAR';

      }

    }
  );

}