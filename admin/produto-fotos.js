const FOTOS_API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


const fotosParametros =
  new URLSearchParams(
    window.location.search
  );


const fotosProdutoId =
  Number(
    fotosParametros.get('id')
  );


const fotosGrid =
  document.getElementById(
    'produto-fotos-grid'
  );


const fotosContador =
  document.getElementById(
    'produto-fotos-contador'
  );


const fotosMensagem =
  document.getElementById(
    'produto-fotos-mensagem'
  );


const fotoInput =
  document.getElementById(
    'produto-foto-input'
  );


const fotoEscolher =
  document.getElementById(
    'produto-foto-escolher'
  );


const fotoEnviar =
  document.getElementById(
    'produto-foto-enviar'
  );


const fotoArquivo =
  document.getElementById(
    'produto-foto-arquivo'
  );



/* =============================================================
   TOKEN
============================================================= */

function fotosTokenAdmin() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



/* =============================================================
   TOKEN EXPIRADO
============================================================= */

function fotosTratarAutenticacao(
  resposta
) {

  if (
    resposta.status === 401 ||
    resposta.status === 403
  ) {

    sessionStorage.removeItem(
      'hazeAdminToken'
    );

    sessionStorage.removeItem(
      'hazeAdmin'
    );


    window.location.href =
      'login.html';


    return true;

  }


  return false;

}



/* =============================================================
   CARREGAR PRODUTO
============================================================= */

async function carregarProdutoFotos() {

  if (
    !Number.isInteger(fotosProdutoId) ||
    fotosProdutoId <= 0
  ) {

    fotosMensagem.textContent =
      'ID do produto inválido.';

    return;

  }


  const token =
    fotosTokenAdmin();


  try {

    /*
      Usamos a listagem administrativa
      porque ela também consegue enxergar
      produtos inativos.
    */

    const resposta = await fetch(
      `${FOTOS_API_URL}/admin/produtos`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`
        }
      }
    );


    if (
      fotosTratarAutenticacao(
        resposta
      )
    ) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar o produto.'
      );

    }


    const produtos =
      await resposta.json();


    const produto =
      produtos.find(
        item =>
          Number(item.id) ===
          fotosProdutoId
      );


    if (!produto) {

      throw new Error(
        'Produto não encontrado.'
      );

    }


    document.getElementById(
      'fotos-produto-nome'
    ).textContent =
      `${produto.nome} — Produto #${produto.id}`;


    document.getElementById(
      'fotos-voltar-produto'
    ).href =
      `produto-editar.html?id=${produto.id}`;


    document.getElementById(
      'fotos-ver-produto'
    ).href =
      `/hazedrip/frontend/produto.html?id=${produto.id}`;


    await carregarFotosProduto();


  } catch (erro) {

    console.error(
      'Erro ao carregar produto:',
      erro
    );


    fotosMensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   CARREGAR FOTOS
============================================================= */

async function carregarFotosProduto() {

  try {

    const resposta =
      await fetch(
        `${FOTOS_API_URL}/produtos/${fotosProdutoId}/imagens`
      );


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar as fotos.'
      );

    }


    const imagens =
      await resposta.json();


    renderizarFotos(
      imagens
    );


  } catch (erro) {

    console.error(
      'Erro ao carregar fotos:',
      erro
    );


    fotosGrid.innerHTML = `
      <div class="admin-table-message">
        Não foi possível carregar as fotos.
      </div>
    `;

  }

}



/* =============================================================
   RENDERIZAR
============================================================= */

function renderizarFotos(imagens) {

  fotosGrid.innerHTML = '';


  fotosContador.textContent =
    `${imagens.length} ${
      imagens.length === 1
        ? 'foto'
        : 'fotos'
    }`;


  if (imagens.length === 0) {

    fotosGrid.innerHTML = `

      <div class="admin-photos-empty">

        <strong>
          Nenhuma foto cadastrada
        </strong>

        <p>
          Adicione a primeira imagem
          deste produto.
        </p>

      </div>

    `;

    return;

  }


  const imagensOrdenadas =
    [...imagens].sort(
      (a, b) => {

        if (
          Number(a.principal) !==
          Number(b.principal)
        ) {

          return (
            Number(b.principal) -
            Number(a.principal)
          );

        }


        return (
          Number(a.ordem || 0) -
          Number(b.ordem || 0)
        );

      }
    );


  imagensOrdenadas.forEach(
    imagem => {


      const principal =
        Number(imagem.principal) === 1;


      const card =
        document.createElement(
          'article'
        );


      card.className =
        'admin-photo-card';


      card.innerHTML = `

        <div class="admin-photo-preview">

          <img
            src="${escaparFotos(imagem.url)}"
            alt="Foto do produto"
          >

          ${
            principal
              ? `
                <span class="admin-photo-main-badge">
                  ★ Principal
                </span>
              `
              : ''
          }

        </div>


        <div class="admin-photo-info">

          <span>
            Imagem #${Number(imagem.id)}
          </span>

        </div>


        <div class="admin-photo-actions">


          ${
            !principal
              ? `
                <button
                  type="button"
                  class="admin-photo-main-btn"
                  data-imagem-id="${Number(imagem.id)}"
                >
                  Definir como principal
                </button>
              `
              : `
                <span class="admin-photo-current">
                  Imagem principal
                </span>
              `
          }


          <button
            type="button"
            class="admin-photo-delete-btn"
            data-imagem-id="${Number(imagem.id)}"
          >
            Remover
          </button>


        </div>

      `;


      fotosGrid.appendChild(
        card
      );

    }
  );


  configurarAcoesFotos();

}



/* =============================================================
   ESCOLHER ARQUIVO
============================================================= */

fotoEscolher.addEventListener(
  'click',
  () => {

    fotoInput.click();

  }
);



fotoInput.addEventListener(
  'change',
  () => {


    const arquivo =
      fotoInput.files[0];


    if (!arquivo) {

      fotoArquivo.textContent =
        'Nenhum arquivo selecionado';

      fotoEnviar.disabled =
        true;

      return;

    }


    fotoArquivo.textContent =
      arquivo.name;


    fotoEnviar.disabled =
      false;

  }
);



/* =============================================================
   ENVIAR FOTO
============================================================= */

fotoEnviar.addEventListener(
  'click',
  async () => {


    const arquivo =
      fotoInput.files[0];


    if (!arquivo) {

      fotosMensagem.textContent =
        'Escolha uma imagem.';

      return;

    }


    const tiposPermitidos = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];


    if (
      !tiposPermitidos.includes(
        arquivo.type
      )
    ) {

      fotosMensagem.textContent =
        'Use uma imagem JPG, PNG ou WEBP.';

      return;

    }


    if (
      arquivo.size >
      5 * 1024 * 1024
    ) {

      fotosMensagem.textContent =
        'A imagem deve ter no máximo 5 MB.';

      return;

    }


    const formData =
      new FormData();


    /*
      IMPORTANTE:
      o backend espera exatamente
      o campo chamado "imagem".
    */

    formData.append(
      'imagem',
      arquivo
    );


    try {

      fotosMensagem.classList.remove(
        'sucesso'
      );


      fotosMensagem.textContent = '';


      fotoEnviar.disabled =
        true;


      fotoEnviar.textContent =
        'ENVIANDO...';


      const token =
        fotosTokenAdmin();


      const resposta =
        await fetch(
          `${FOTOS_API_URL}/produtos/${fotosProdutoId}/imagens`,
          {

            method: 'POST',

            headers: {

              Authorization:
                `Bearer ${token}`

            },

            body:
              formData

          }
        );


      if (
        fotosTratarAutenticacao(
          resposta
        )
      ) {
        return;
      }


      const resultado =
        await resposta.json();


      if (!resposta.ok) {

        throw new Error(
          resultado.mensagem ||
          'Não foi possível enviar a foto.'
        );

      }


      /*
        Verifica quantas fotos existem.

        Se esta for a primeira,
        automaticamente a torna principal.
      */

      const respostaFotos =
        await fetch(
          `${FOTOS_API_URL}/produtos/${fotosProdutoId}/imagens`
        );


      const imagens =
        await respostaFotos.json();


      if (
        imagens.length === 1 &&
        Number(
          imagens[0].principal
        ) !== 1
      ) {

        await definirFotoPrincipal(
          imagens[0].id,
          false
        );

      }


      fotosMensagem.classList.add(
        'sucesso'
      );


      fotosMensagem.textContent =
        'Foto adicionada com sucesso.';


      fotoInput.value = '';


      fotoArquivo.textContent =
        'Nenhum arquivo selecionado';


      await carregarFotosProduto();


    } catch (erro) {

      console.error(
        'Erro ao enviar foto:',
        erro
      );


      fotosMensagem.classList.remove(
        'sucesso'
      );


      fotosMensagem.textContent =
        erro.message;


    } finally {

      fotoEnviar.disabled =
        true;


      fotoEnviar.textContent =
        'ENVIAR FOTO';

    }

  }
);



/* =============================================================
   AÇÕES DOS CARDS
============================================================= */

function configurarAcoesFotos() {


  document
    .querySelectorAll(
      '.admin-photo-main-btn'
    )
    .forEach(botao => {


      botao.addEventListener(
        'click',
        async () => {


          const imagemId =
            Number(
              botao.dataset.imagemId
            );


          await definirFotoPrincipal(
            imagemId
          );

        }
      );


    });



  document
    .querySelectorAll(
      '.admin-photo-delete-btn'
    )
    .forEach(botao => {


      botao.addEventListener(
        'click',
        async () => {


          const imagemId =
            Number(
              botao.dataset.imagemId
            );


          await removerFoto(
            imagemId
          );

        }
      );


    });

}



/* =============================================================
   DEFINIR PRINCIPAL
============================================================= */

async function definirFotoPrincipal(
  imagemId,
  mostrarMensagem = true
) {

  try {

    const token =
      fotosTokenAdmin();


    const resposta =
      await fetch(
        `${FOTOS_API_URL}/produtos/${fotosProdutoId}/imagens/${imagemId}/principal`,
        {

          method: 'PATCH',

          headers: {

            Authorization:
              `Bearer ${token}`

          }

        }
      );


    if (
      fotosTratarAutenticacao(
        resposta
      )
    ) {
      return;
    }


    const resultado =
      await resposta.json();


    if (!resposta.ok) {

      throw new Error(
        resultado.mensagem ||
        'Não foi possível alterar a foto principal.'
      );

    }


    if (mostrarMensagem) {

      fotosMensagem.classList.add(
        'sucesso'
      );


      fotosMensagem.textContent =
        'Foto principal alterada com sucesso.';

    }


    await carregarFotosProduto();


  } catch (erro) {

    console.error(
      'Erro ao definir foto principal:',
      erro
    );


    fotosMensagem.classList.remove(
      'sucesso'
    );


    fotosMensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   REMOVER FOTO
============================================================= */

async function removerFoto(
  imagemId
) {


  const confirmou =
    window.confirm(
      'Deseja realmente remover esta foto?'
    );


  if (!confirmou) {
    return;
  }


  try {

    const token =
      fotosTokenAdmin();


    const resposta =
      await fetch(
        `${FOTOS_API_URL}/produtos/${fotosProdutoId}/imagens/${imagemId}`,
        {

          method: 'DELETE',

          headers: {

            Authorization:
              `Bearer ${token}`

          }

        }
      );


    if (
      fotosTratarAutenticacao(
        resposta
      )
    ) {
      return;
    }


    const resultado =
      await resposta.json();


    if (!resposta.ok) {

      throw new Error(
        resultado.mensagem ||
        'Não foi possível remover a foto.'
      );

    }


    fotosMensagem.classList.add(
      'sucesso'
    );


    fotosMensagem.textContent =
      'Foto removida com sucesso.';


    await carregarFotosProduto();


  } catch (erro) {

    console.error(
      'Erro ao remover foto:',
      erro
    );


    fotosMensagem.classList.remove(
      'sucesso'
    );


    fotosMensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   SEGURANÇA DE HTML
============================================================= */

function escaparFotos(valor) {

  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}



/* =============================================================
   INICIAR
============================================================= */

carregarProdutoFotos();