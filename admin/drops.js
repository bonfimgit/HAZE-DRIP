const DROPS_API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


let produtosDrops = [];



/* =============================================================
   TOKEN
============================================================= */

function dropsToken() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



/* =============================================================
   AUTENTICAÇÃO
============================================================= */

function dropsTratarAutenticacao(
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
   CARREGAR PRODUTOS
============================================================= */

async function carregarDrops() {

  const grid =
    document.getElementById(
      'drops-grid'
    );


  try {

    const token =
      dropsToken();


    const resposta =
      await fetch(
        `${DROPS_API_URL}/admin/produtos`,
        {

          headers: {

            Authorization:
              `Bearer ${token}`

          }

        }
      );


    if (
      dropsTratarAutenticacao(
        resposta
      )
    ) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar os produtos.'
      );

    }


    const produtos =
      await resposta.json();


    /*
      Para Drops da Home mostramos
      somente produtos ativos.
    */

    produtosDrops =
      produtos.filter(
        produto =>
          Number(produto.ativo) !== 0
      );


    renderizarDrops(
      produtosDrops
    );


  } catch (erro) {

    console.error(
      'Erro ao carregar Drops:',
      erro
    );


    grid.innerHTML = `

      <div class="admin-table-message">

        Não foi possível carregar
        os produtos.

      </div>

    `;

  }

}



/* =============================================================
   RENDERIZAR
============================================================= */

function renderizarDrops(
  produtos
) {

  const grid =
    document.getElementById(
      'drops-grid'
    );


  atualizarResumoDrops();


  if (produtos.length === 0) {

    grid.innerHTML = `

      <div class="admin-photos-empty">

        <strong>
          Nenhum produto encontrado
        </strong>

      </div>

    `;

    return;

  }


  grid.innerHTML = '';


  produtos.forEach(
    produto => {


      const destaque =
        Number(
          produto.destaque_home
        ) !== 0;


      const imagem =
        produto.imagem_principal ||
        '/hazedrip/assets/haze-logo.png';


      const preco =
        Number(
          produto.preco
        ).toLocaleString(
          'pt-BR',
          {
            style: 'currency',
            currency: 'BRL'
          }
        );


      const card =
        document.createElement(
          'article'
        );


      card.className =
        destaque
          ? 'admin-drop-card destaque'
          : 'admin-drop-card';


      card.innerHTML = `

        <div class="admin-drop-image">

          <img
            src="${imagem}"
            alt=""
          >


          ${
            destaque
              ? `
                <span class="admin-drop-badge">
                  ★ Em destaque
                </span>
              `
              : ''
          }

        </div>


        <div class="admin-drop-content">

          <div>

            <span class="admin-drop-category">

              ${
                escaparDrops(
                  produto.categoria_nome ||
                  'Sem categoria'
                )
              }

            </span>


            <h2>

              ${
                escaparDrops(
                  produto.nome
                )
              }

            </h2>


            <strong class="admin-drop-price">

              ${preco}

            </strong>

          </div>


          <button
            type="button"

            class="
              admin-drop-toggle
              ${
                destaque
                  ? 'remover'
                  : ''
              }
            "

            data-produto-id="${produto.id}"

            data-destaque="${
              destaque
                ? '1'
                : '0'
            }"
          >

            ${
              destaque
                ? 'Remover destaque'
                : 'Destacar produto'
            }

          </button>

        </div>

      `;


      grid.appendChild(
        card
      );


    }
  );


  configurarBotoesDrops();

}



/* =============================================================
   RESUMO
============================================================= */

function atualizarResumoDrops() {

  const total =
    produtosDrops.length;


  const destaques =
    produtosDrops.filter(
      produto =>
        Number(
          produto.destaque_home
        ) !== 0
    ).length;


  document.getElementById(
    'drops-total-produtos'
  ).textContent =
    total;


  document.getElementById(
    'drops-total-destaques'
  ).textContent =
    destaques;

}



/* =============================================================
   ALTERAR DESTAQUE
============================================================= */

function configurarBotoesDrops() {

  document
    .querySelectorAll(
      '.admin-drop-toggle'
    )
    .forEach(
      botao => {


        botao.addEventListener(
          'click',
          async () => {


            const produtoId =
              Number(
                botao.dataset.produtoId
              );


            const destaqueAtual =
              botao.dataset.destaque ===
              '1';


            await alterarDestaque(
              produtoId,
              !destaqueAtual,
              botao
            );


          }
        );


      }
    );

}



async function alterarDestaque(
  produtoId,
  novoDestaque,
  botao
) {

  const mensagem =
    document.getElementById(
      'drops-mensagem'
    );


  try {

    mensagem.textContent = '';

    mensagem.classList.remove(
      'sucesso'
    );


    botao.disabled =
      true;


    botao.textContent =
      'SALVANDO...';


    const token =
      dropsToken();


    const resposta =
      await fetch(
        `${DROPS_API_URL}/admin/produtos/${produtoId}/destaque`,
        {

          method: 'PATCH',

          headers: {

            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${token}`

          },

          body:
            JSON.stringify({

              destaque_home:
                novoDestaque

            })

        }
      );


    if (
      dropsTratarAutenticacao(
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
        'Não foi possível alterar o destaque.'
      );

    }


    /*
      Atualizamos nosso array local
      com o valor retornado pela API.
    */

    const produto =
      produtosDrops.find(
        item =>
          Number(item.id) ===
          produtoId
      );


    if (produto) {

      produto.destaque_home =
        novoDestaque
          ? 1
          : 0;

    }


    mensagem.classList.add(
      'sucesso'
    );


    mensagem.textContent =
      resultado.mensagem ||
      'Destaque atualizado.';


    aplicarBuscaDrops();


  } catch (erro) {

    console.error(
      'Erro ao alterar destaque:',
      erro
    );


    mensagem.classList.remove(
      'sucesso'
    );


    mensagem.textContent =
      erro.message;


    botao.disabled =
      false;


    botao.textContent =
      novoDestaque
        ? 'Destacar produto'
        : 'Remover destaque';

  }

}



/* =============================================================
   BUSCA
============================================================= */

const dropsBusca =
  document.getElementById(
    'drops-busca'
  );


if (dropsBusca) {

  dropsBusca.addEventListener(
    'input',
    aplicarBuscaDrops
  );

}



function aplicarBuscaDrops() {

  const termo =
    dropsBusca
      ? dropsBusca.value
          .trim()
          .toLowerCase()
      : '';


  const filtrados =
    produtosDrops.filter(
      produto => {


        const nome =
          String(
            produto.nome || ''
          ).toLowerCase();


        const categoria =
          String(
            produto.categoria_nome || ''
          ).toLowerCase();


        return (
          nome.includes(termo) ||
          categoria.includes(termo)
        );

      }
    );


  renderizarDrops(
    filtrados
  );

}



/* =============================================================
   SEGURANÇA HTML
============================================================= */

function escaparDrops(
  valor
) {

  return String(
    valor || ''
  )

    .replaceAll(
      '&',
      '&amp;'
    )

    .replaceAll(
      '<',
      '&lt;'
    )

    .replaceAll(
      '>',
      '&gt;'
    )

    .replaceAll(
      '"',
      '&quot;'
    )

    .replaceAll(
      "'",
      '&#039;'
    );

}



/* =============================================================
   INICIAR
============================================================= */

carregarDrops();