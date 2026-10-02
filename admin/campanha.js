const CAMPANHA_API_URL =
  HAZE_API_URL;


let campanhaAtual = null;


const campanhaForm =
  document.getElementById(
    'campanha-form'
  );


const campanhaTitulo =
  document.getElementById(
    'campanha-titulo'
  );


const campanhaSubtitulo =
  document.getElementById(
    'campanha-subtitulo'
  );


const campanhaTextoBotao =
  document.getElementById(
    'campanha-texto-botao'
  );


const campanhaLinkBotao =
  document.getElementById(
    'campanha-link-botao'
  );


const campanhaAtiva =
  document.getElementById(
    'campanha-ativa'
  );


const campanhaImagem =
  document.getElementById(
    'campanha-imagem'
  );


const campanhaPreview =
  document.getElementById(
    'campanha-preview'
  );


const campanhaSemImagem =
  document.getElementById(
    'campanha-sem-imagem'
  );


const campanhaArquivo =
  document.getElementById(
    'campanha-arquivo'
  );


const campanhaMensagem =
  document.getElementById(
    'campanha-mensagem'
  );


const campanhaSalvar =
  document.getElementById(
    'campanha-salvar'
  );



/* =============================================================
   TOKEN
============================================================= */

function campanhaToken() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



/* =============================================================
   AUTENTICAÇÃO
============================================================= */

function campanhaTratarAuth(
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
   CARREGAR CAMPANHA
============================================================= */

async function carregarCampanhaAdmin() {

  try {

    const resposta =
      await fetch(
        `${CAMPANHA_API_URL}/admin/campanhas`,
        {

          headers: {

            Authorization:
              `Bearer ${campanhaToken()}`

          }

        }
      );


    if (
      campanhaTratarAuth(
        resposta
      )
    ) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar a campanha.'
      );

    }


    const campanhas =
      await resposta.json();


    if (
      !Array.isArray(campanhas) ||
      campanhas.length === 0
    ) {

      campanhaMensagem.textContent =
        'Nenhuma campanha cadastrada.';

      return;

    }


    /*
      Prioridade:
      1 - campanha ativa
      2 - campanha mais recente
    */

    campanhaAtual =
      campanhas.find(
        campanha =>
          Number(campanha.ativo) !== 0
      ) ||
      campanhas[0];


    preencherCampanha(
      campanhaAtual
    );


  } catch (erro) {

    console.error(
      'Erro ao carregar campanha:',
      erro
    );


    campanhaMensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   PREENCHER FORMULÁRIO
============================================================= */

function preencherCampanha(
  campanha
) {

  campanhaTitulo.value =
    campanha.titulo || '';


  campanhaSubtitulo.value =
    campanha.subtitulo || '';


  campanhaTextoBotao.value =
    campanha.texto_botao || '';


  campanhaLinkBotao.value =
    campanha.link_botao || '';


  campanhaAtiva.checked =
    Number(campanha.ativo) !== 0;


  mostrarPreviewCampanha(
    campanha.imagem_url
  );

}



/* =============================================================
   PREVIEW
============================================================= */

function mostrarPreviewCampanha(
  url
) {

  if (!url) {

    campanhaPreview.style.display =
      'none';

    campanhaSemImagem.style.display =
      'flex';

    return;

  }


  campanhaPreview.src =
    url;


  campanhaPreview.style.display =
    'block';


  campanhaSemImagem.style.display =
    'none';

}



/* =============================================================
   SELECIONAR IMAGEM
============================================================= */

document
  .getElementById(
    'campanha-escolher-imagem'
  )
  .addEventListener(
    'click',
    () => {

      campanhaImagem.click();

    }
  );



campanhaImagem.addEventListener(
  'change',
  () => {


    const arquivo =
      campanhaImagem.files[0];


    if (!arquivo) {

      campanhaArquivo.textContent =
        'Nenhuma nova imagem selecionada';

      return;

    }


    campanhaArquivo.textContent =
      arquivo.name;


    /*
      Preview local antes do upload.
    */

    const urlLocal =
      URL.createObjectURL(
        arquivo
      );


    mostrarPreviewCampanha(
      urlLocal
    );

  }
);



/* =============================================================
   SALVAR
============================================================= */

campanhaForm.addEventListener(
  'submit',
  async evento => {


    evento.preventDefault();


    if (!campanhaAtual) {

      campanhaMensagem.textContent =
        'Nenhuma campanha disponível para edição.';

      return;

    }


    if (
      !campanhaTitulo.value.trim()
    ) {

      campanhaMensagem.textContent =
        'Informe o título da campanha.';

      return;

    }


    const arquivo =
      campanhaImagem.files[0];


    if (arquivo) {


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

        campanhaMensagem.textContent =
          'Use JPG, PNG ou WEBP.';

        return;

      }


      if (
        arquivo.size >
        5 * 1024 * 1024
      ) {

        campanhaMensagem.textContent =
          'A imagem deve ter no máximo 5 MB.';

        return;

      }

    }


    const dados =
      new FormData();


    dados.append(
      'titulo',
      campanhaTitulo.value.trim()
    );


    dados.append(
      'subtitulo',
      campanhaSubtitulo.value.trim()
    );


    dados.append(
      'texto_botao',
      campanhaTextoBotao.value.trim()
    );


    dados.append(
      'link_botao',
      campanhaLinkBotao.value.trim()
    );


    dados.append(
      'ativo',
      campanhaAtiva.checked
        ? 'true'
        : 'false'
    );


    if (arquivo) {

      dados.append(
        'imagem',
        arquivo
      );

    }


    try {

      campanhaMensagem.classList.remove(
        'sucesso'
      );


      campanhaMensagem.textContent = '';


      campanhaSalvar.disabled =
        true;


      campanhaSalvar.textContent =
        'SALVANDO...';


      const resposta =
        await fetch(
          `${CAMPANHA_API_URL}/admin/campanhas/${campanhaAtual.id}`,
          {

            method: 'PUT',

            headers: {

              Authorization:
                `Bearer ${campanhaToken()}`

            },

            body:
              dados

          }
        );


      if (
        campanhaTratarAuth(
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
          'Não foi possível salvar a campanha.'
        );

      }


      campanhaAtual =
        resultado.campanha;


      preencherCampanha(
        campanhaAtual
      );


      campanhaImagem.value =
        '';


      campanhaArquivo.textContent =
        'Nenhuma nova imagem selecionada';


      campanhaMensagem.classList.add(
        'sucesso'
      );


      campanhaMensagem.textContent =
        'Campanha atualizada com sucesso.';


    } catch (erro) {

      console.error(
        'Erro ao salvar campanha:',
        erro
      );


      campanhaMensagem.classList.remove(
        'sucesso'
      );


      campanhaMensagem.textContent =
        erro.message;


    } finally {

      campanhaSalvar.disabled =
        false;


      campanhaSalvar.textContent =
        'SALVAR CAMPANHA';

    }


  }
);



/* =============================================================
   INICIAR
============================================================= */

carregarCampanhaAdmin();