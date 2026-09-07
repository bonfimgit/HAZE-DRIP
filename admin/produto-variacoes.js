const VARIACOES_API =
  'https://hazedrip-production-6a67.up.railway.app';


const parametros =
  new URLSearchParams(
    window.location.search
  );


const produtoId =
  Number(
    parametros.get('id')
  );


const lista =
  document.getElementById(
    'variacoes-lista'
  );


const mensagem =
  document.getElementById(
    'variacoes-mensagem'
  );


const form =
  document.getElementById(
    'variacao-form'
  );



function tokenVariacoes() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



function tratarAuthVariacoes(
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
   PRODUTO
============================================================= */

async function carregarNomeProduto() {

  const resposta =
    await fetch(
      `${VARIACOES_API}/admin/produtos`,
      {

        headers: {

          Authorization:
            `Bearer ${tokenVariacoes()}`

        }

      }
    );


  if (
    tratarAuthVariacoes(
      resposta
    )
  ) {
    return;
  }


  const produtos =
    await resposta.json();


  const produto =
    produtos.find(
      item =>
        Number(item.id) ===
        produtoId
    );


  if (!produto) {
    return;
  }


  document.getElementById(
    'variacoes-produto-nome'
  ).textContent =
    `${produto.nome} — Produto #${produto.id}`;


  document.getElementById(
    'variacoes-voltar'
  ).href =
    `produto-editar.html?id=${produto.id}`;

}



/* =============================================================
   CARREGAR VARIAÇÕES
============================================================= */

async function carregarVariacoes() {

  try {

    const resposta =
      await fetch(
        `${VARIACOES_API}/admin/produtos/${produtoId}/variacoes`,
        {

          headers: {

            Authorization:
              `Bearer ${tokenVariacoes()}`

          }

        }
      );


    if (
      tratarAuthVariacoes(
        resposta
      )
    ) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Erro ao carregar variações.'
      );

    }


    const variacoes =
      await resposta.json();


    renderizarVariacoes(
      variacoes
    );


  } catch (erro) {

    console.error(
      erro
    );


    lista.innerHTML = `

      <tr>

        <td colspan="6">
          Não foi possível carregar.
        </td>

      </tr>

    `;

  }

}



/* =============================================================
   RENDERIZAR
============================================================= */

function renderizarVariacoes(
  variacoes
) {

  lista.innerHTML = '';


  let estoqueTotal = 0;


  if (variacoes.length === 0) {

    lista.innerHTML = `

      <tr>

        <td colspan="6">
          Nenhuma variação cadastrada.
        </td>

      </tr>

    `;

  }


  variacoes.forEach(
    variacao => {


      const ativo =
        Number(
          variacao.ativo
        ) !== 0;


      estoqueTotal +=
        ativo
          ? Number(
              variacao.estoque
            )
          : 0;


      const tr =
        document.createElement(
          'tr'
        );


      tr.innerHTML = `

        <td>
          ${escaparVariacao(variacao.cor)}
        </td>


        <td>
          ${escaparVariacao(variacao.tamanho)}
        </td>


        <td>
          ${escaparVariacao(variacao.sku)}
        </td>


        <td>

          <div class="d-flex gap-2">

            <input
              type="number"

              class="
                form-control
                form-control-sm
                estoque-input
              "

              style="max-width:90px"

              min="0"

              value="${variacao.estoque}"

              data-variacao-id="${variacao.id}"
            >


            <button
              type="button"

              class="
                btn
                btn-sm
                btn-outline-light
                salvar-estoque
              "

              data-variacao-id="${variacao.id}"
            >
              Salvar
            </button>

          </div>

        </td>


        <td>

          ${
            ativo
              ? `
                  <span class="badge text-bg-success">
                    Ativa
                  </span>
                `
              : `
                  <span class="badge text-bg-secondary">
                    Inativa
                  </span>
                `
          }

        </td>

          <button
  type="button"

  class="
    btn
    btn-sm
    btn-outline-light
    editar-variacao
  "

  data-variacao-id="${variacao.id}"

  data-cor="${escaparVariacao(variacao.cor)}"

  data-tamanho="${escaparVariacao(variacao.tamanho)}"

  data-sku="${escaparVariacao(variacao.sku)}"

  data-estoque="${variacao.estoque}"

  data-ativo="${ativo ? '1' : '0'}"
>
  Editar
</button>

        <td>

          ${
            ativo
              ? `
                  <button
                    type="button"
                    class="
                      btn
                      btn-sm
                      btn-outline-danger
                      desativar-variacao
                    "
                    data-variacao-id="${variacao.id}"
                  >
                    Desativar
                  </button>
                `
              : `
                  <button
                    type="button"
                    class="
                      btn
                      btn-sm
                      btn-outline-success
                      reativar-variacao
                    "
                    data-variacao-id="${variacao.id}"
                  >
                    Reativar
                  </button>
                `
          }

        </td>

      `;


      lista.appendChild(
        tr
      );

    }
  );


  document.getElementById(
    'variacoes-estoque-total'
  ).textContent =
    `${estoqueTotal} ${
      estoqueTotal === 1
        ? 'unidade'
        : 'unidades'
    }`;


  configurarBotoesVariacoes();

}



/* =============================================================
   ADICIONAR
============================================================= */

form.addEventListener(
  'submit',
  async evento => {


    evento.preventDefault();


    const tamanho =
      document
        .getElementById(
          'variacao-tamanho'
        )
        .value
        .trim();


    const cor =
      document
        .getElementById(
          'variacao-cor'
        )
        .value
        .trim();


    const sku =
      document
        .getElementById(
          'variacao-sku'
        )
        .value
        .trim();


    const estoque =
      Number(
        document.getElementById(
          'variacao-estoque'
        ).value
      );


    if (
      !tamanho ||
      !cor ||
      !sku
    ) {

      mensagem.textContent =
        'Preencha todos os campos.';

      return;

    }


    if (
      !Number.isInteger(estoque) ||
      estoque < 0
    ) {

      mensagem.textContent =
        'Estoque inválido.';

      return;

    }


    try {

      const resposta =
        await fetch(
          `${VARIACOES_API}/produtos/${produtoId}/variacoes`,
          {

            method: 'POST',

            headers: {

              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${tokenVariacoes()}`

            },

            body:
              JSON.stringify({

                tamanho,
                cor,
                estoque,
                sku

              })

          }
        );


      if (
        tratarAuthVariacoes(
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
          'Erro ao adicionar variação.'
        );

      }


      mensagem.classList.add(
        'sucesso'
      );


      mensagem.textContent =
        'Variação adicionada com sucesso.';


      form.reset();


      document.getElementById(
        'variacao-estoque'
      ).value = 0;


      await carregarVariacoes();


    } catch (erro) {

      mensagem.classList.remove(
        'sucesso'
      );


      mensagem.textContent =
        erro.message;

    }

  }
);



/* =============================================================
   BOTÕES
============================================================= */

function configurarBotoesVariacoes() {

    document
  .querySelectorAll(
    '.editar-variacao'
  )
  .forEach(
    botao => {

      botao.addEventListener(
        'click',
        () => {

          abrirEdicaoVariacao(
            botao
          );

        }
      );

    }
  );

  document
    .querySelectorAll(
      '.salvar-estoque'
    )
    .forEach(
      botao => {


        botao.addEventListener(
          'click',
          async () => {


            const variacaoId =
              Number(
                botao.dataset.variacaoId
              );


            const input =
              document.querySelector(
                `.estoque-input[data-variacao-id="${variacaoId}"]`
              );


            await atualizarEstoque(
              variacaoId,
              Number(input.value)
            );

          }
        );


      }
    );



  document
    .querySelectorAll(
      '.desativar-variacao'
    )
    .forEach(
      botao => {


        botao.addEventListener(
          'click',
          () => {

            alterarStatusVariacao(
              Number(
                botao.dataset.variacaoId
              ),
              false
            );

          }
        );


      }
    );



  document
    .querySelectorAll(
      '.reativar-variacao'
    )
    .forEach(
      botao => {


        botao.addEventListener(
          'click',
          () => {

            alterarStatusVariacao(
              Number(
                botao.dataset.variacaoId
              ),
              true
            );

          }
        );


      }
    );

}



/* =============================================================
   ESTOQUE
============================================================= */

async function atualizarEstoque(
  variacaoId,
  estoque
) {

  if (
    !Number.isInteger(estoque) ||
    estoque < 0
  ) {

    mensagem.textContent =
      'Estoque inválido.';

    return;

  }


  try {

    const resposta =
      await fetch(
        `${VARIACOES_API}/produtos/${produtoId}/variacoes/${variacaoId}/estoque`,
        {

          method: 'PATCH',

          headers: {

            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${tokenVariacoes()}`

          },

          body:
            JSON.stringify({
              estoque
            })

        }
      );


    const resultado =
      await resposta.json();


    if (!resposta.ok) {

      throw new Error(
        resultado.mensagem
      );

    }


    mensagem.classList.add(
      'sucesso'
    );


    mensagem.textContent =
      'Estoque atualizado.';


    await carregarVariacoes();


  } catch (erro) {

    mensagem.classList.remove(
      'sucesso'
    );


    mensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   ATIVAR / DESATIVAR
============================================================= */

async function alterarStatusVariacao(
  variacaoId,
  ativar
) {

  const url =
    ativar

      ? `${VARIACOES_API}/produtos/${produtoId}/variacoes/${variacaoId}/reativar`

      : `${VARIACOES_API}/produtos/${produtoId}/variacoes/${variacaoId}`;


  try {

    const resposta =
      await fetch(
        url,
        {

          method:
            ativar
              ? 'PATCH'
              : 'DELETE',

          headers: {

            Authorization:
              `Bearer ${tokenVariacoes()}`

          }

        }
      );


    const resultado =
      await resposta.json();


    if (!resposta.ok) {

      throw new Error(
        resultado.mensagem
      );

    }


    mensagem.classList.add(
      'sucesso'
    );


    mensagem.textContent =
      ativar
        ? 'Variação reativada.'
        : 'Variação desativada.';


    await carregarVariacoes();


  } catch (erro) {

    mensagem.classList.remove(
      'sucesso'
    );


    mensagem.textContent =
      erro.message;

  }

}

/* =============================================================
   EDITAR VARIAÇÃO
============================================================= */

function abrirEdicaoVariacao(
  botao
) {

  const campoVariacaoId =
  document.getElementById(
    'editar-variacao-id'
  );


  campoVariacaoId.value =
    botao.dataset.variacaoId;


  campoVariacaoId.dataset.ativo =
    botao.dataset.ativo;


  document.getElementById(
    'editar-variacao-cor'
  ).value =
    botao.dataset.cor;


  document.getElementById(
    'editar-variacao-tamanho'
  ).value =
    botao.dataset.tamanho;


  document.getElementById(
    'editar-variacao-sku'
  ).value =
    botao.dataset.sku;


  document.getElementById(
    'editar-variacao-estoque'
  ).value =
    botao.dataset.estoque;


  const modal =
    new bootstrap.Modal(
      document.getElementById(
        'modalEditarVariacao'
      )
    );


  modal.show();

}
document
  .getElementById(
    'editar-variacao-salvar'
  )
  .addEventListener(
    'click',
    async () => {


      const campoVariacaoId =
  document.getElementById(
    'editar-variacao-id'
  );


const variacaoId =
  Number(
    campoVariacaoId.value
  );


const ativo =
  Number(
    campoVariacaoId.dataset.ativo
  ) === 1
    ? 1
    : 0;


      const cor =
        document.getElementById(
          'editar-variacao-cor'
        ).value.trim();


      const tamanho =
        document.getElementById(
          'editar-variacao-tamanho'
        ).value.trim();


      const sku =
        document.getElementById(
          'editar-variacao-sku'
        ).value.trim();


      const estoque =
        Number(
          document.getElementById(
            'editar-variacao-estoque'
          ).value
        );


      if (
        !cor ||
        !tamanho ||
        !sku
      ) {

        mensagem.textContent =
          'Preencha todos os campos.';

        return;

      }


      if (
        !Number.isInteger(estoque) ||
        estoque < 0
      ) {

        mensagem.textContent =
          'Estoque inválido.';

        return;

      }


      try {

        const resposta =
          await fetch(
            `${VARIACOES_API}/produtos/${produtoId}/variacoes/${variacaoId}`,
            {

              method: 'PUT',

              headers: {

                'Content-Type':
                  'application/json',

                Authorization:
                  `Bearer ${tokenVariacoes()}`

              },

              body:
                JSON.stringify({

                  tamanho,
                  cor,
                  estoque,
                  sku,
                  ativo

                })

            }
          );


        if (
          tratarAuthVariacoes(
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
            'Erro ao atualizar variação.'
          );

        }


        const modalElemento =
          document.getElementById(
            'modalEditarVariacao'
          );


        const modal =
          bootstrap.Modal.getInstance(
            modalElemento
          );


        modal.hide();


        mensagem.classList.add(
          'sucesso'
        );


        mensagem.textContent =
          'Variação atualizada com sucesso.';


        await carregarVariacoes();


      } catch (erro) {

        mensagem.classList.remove(
          'sucesso'
        );


        mensagem.textContent =
          erro.message;

      }


    }
  );

/* =============================================================
   ESCAPAR HTML
============================================================= */

function escaparVariacao(
  valor
) {

  return String(
    valor || ''
  )

    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}



/* =============================================================
   INICIAR
============================================================= */

if (
  !Number.isInteger(produtoId) ||
  produtoId <= 0
) {

  mensagem.textContent =
    'ID do produto inválido.';

} else {

  carregarNomeProduto();

  carregarVariacoes();

}