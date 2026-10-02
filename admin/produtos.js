const PRODUTOS_API_URL =
  HAZE_API_URL;


let adminProdutos = [];



/* =============================================================
   CARREGAR PRODUTOS
============================================================= */

async function carregarProdutosAdmin() {

  const lista =
    document.getElementById(
      'admin-produtos-lista'
    );


  if (!lista) {
    return;
  }


  try {

    const resposta = await fetch(
      `${PRODUTOS_API_URL}/admin/produtos`, {headers: {
        Authorization: `Bearer ${sessionStorage.getItem('hazeAdminToken')}`
      }}
    )


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar os produtos.'
      );

    }


    adminProdutos =
      await resposta.json();


    renderizarProdutosAdmin(
      adminProdutos
    );


  } catch (erro) {

    console.error(
      'Erro ao carregar produtos:',
      erro
    );


    lista.innerHTML = `
      <tr>

        <td colspan="6">

          <div class="admin-table-message">

            Não foi possível carregar
            os produtos.

          </div>

        </td>

      </tr>
    `;

  }

}



/* =============================================================
   RENDERIZAR PRODUTOS
============================================================= */

function renderizarProdutosAdmin(produtos) {

  const lista =
    document.getElementById(
      'admin-produtos-lista'
    );


  const contador =
    document.getElementById(
      'admin-produtos-contador'
    );


  if (!lista) {
    return;
  }


  contador.textContent =
    `${produtos.length} ${
      produtos.length === 1
        ? 'produto'
        : 'produtos'
    }`;


  if (produtos.length === 0) {

    lista.innerHTML = `
      <tr>

        <td colspan="6">

          <div class="admin-table-message">

            Nenhum produto encontrado.

          </div>

        </td>

      </tr>
    `;

    return;

  }


  lista.innerHTML =
    produtos.map(produto => {


      const imagem =
        produto.imagem_principal ||
        '../assets/haze-logo.png';


      const categoria =
        produto.categoria_nome ||
        'Sem categoria';


      const preco =
        Number(produto.preco)
          .toLocaleString(
            'pt-BR',
            {
              style: 'currency',
              currency: 'BRL'
            }
          );


      const ativo =
        Number(produto.ativo) !== 0;


      return `

        <tr>

          <td>

            <div class="admin-product-image">

              <img
                src="${escaparHtmlAdmin(imagem)}"
                alt="${escaparHtmlAdmin(produto.nome)}"
              >

            </div>

          </td>


          <td>

            <div class="admin-product-name">

              <strong>
                ${escaparHtmlAdmin(produto.nome)}
              </strong>

              <span>
                ID #${produto.id}
              </span>

            </div>

          </td>


          <td>

            ${escaparHtmlAdmin(categoria)}

          </td>


          <td class="admin-product-price">

            ${preco}

          </td>


          <td>

            <span class="
              admin-status
              ${
                ativo
                  ? 'ativo'
                  : 'inativo'
              }
            ">

              ${
                ativo
                  ? 'Ativo'
                  : 'Inativo'
              }

            </span>

          </td>


          <td>

            <button
              type="button"
              class="admin-edit-btn"
              data-produto-id="${produto.id}"
            >
              Editar
            </button>

          </td>


        </tr>

      `;

    }).join('');


  configurarBotoesEditar();

}



/* =============================================================
   BOTÃO EDITAR
============================================================= */

function configurarBotoesEditar() {

  document
    .querySelectorAll(
      '.admin-edit-btn'
    )
    .forEach(botao => {


      botao.addEventListener(
        'click',
        () => {


          const produtoId =
            botao.dataset.produtoId;


          window.location.href =
            `produto-editar.html?id=${produtoId}`;

        }
      );


    });

}



/* =============================================================
   BUSCA
============================================================= */

const campoBusca =
  document.getElementById(
    'admin-produto-busca'
  );


if (campoBusca) {

  campoBusca.addEventListener(
    'input',
    () => {


      const busca =
        campoBusca.value
          .trim()
          .toLowerCase();


      const produtosFiltrados =
        adminProdutos.filter(
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
              nome.includes(busca) ||
              categoria.includes(busca)
            );

          }
        );


      renderizarProdutosAdmin(
        produtosFiltrados
      );


    }
  );

}



/* =============================================================
   NOVO PRODUTO
============================================================= */

const botaoNovoProduto =
  document.getElementById(
    'admin-novo-produto'
  );


if (botaoNovoProduto) {

  botaoNovoProduto.addEventListener(
    'click',
    () => {

      window.location.href =
        'produto-novo.html';

    }
  );

}



/* =============================================================
   SEGURANÇA DE HTML
============================================================= */

function escaparHtmlAdmin(valor) {

  return String(valor || '')

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

carregarProdutosAdmin();