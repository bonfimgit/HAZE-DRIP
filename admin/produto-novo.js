const NOVO_PRODUTO_API =
  'https://hazedrip-production-6a67.up.railway.app';


const novoForm =
  document.getElementById(
    'novo-produto-form'
  );


const novoNome =
  document.getElementById(
    'novo-produto-nome'
  );


const novaDescricao =
  document.getElementById(
    'novo-produto-descricao'
  );


const novoPreco =
  document.getElementById(
    'novo-produto-preco'
  );


const novaCategoria =
  document.getElementById(
    'novo-produto-categoria'
  );


const novoAtivo =
  document.getElementById(
    'novo-produto-ativo'
  );


const novoDestaque =
  document.getElementById(
    'novo-produto-destaque'
  );


const novaMensagem =
  document.getElementById(
    'novo-produto-mensagem'
  );


const novoSalvar =
  document.getElementById(
    'novo-produto-salvar'
  );



function pegarTokenNovoProduto() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



function tratarAuthNovoProduto(
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
   CATEGORIAS
============================================================= */

async function carregarCategoriasNovoProduto() {

  try {

    const resposta =
      await fetch(
        `${NOVO_PRODUTO_API}/admin/categorias`,
        {

          headers: {

            Authorization:
              `Bearer ${pegarTokenNovoProduto()}`

          }

        }
      );


    if (
      tratarAuthNovoProduto(
        resposta
      )
    ) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Não foi possível carregar as categorias.'
      );

    }


    const categorias =
      await resposta.json();


    novaCategoria.innerHTML = `
      <option value="">
        Selecione uma categoria
      </option>
    `;


    categorias
      .filter(
        categoria =>
          Number(categoria.ativo) !== 0
      )
      .forEach(
        categoria => {


          const option =
            document.createElement(
              'option'
            );


          option.value =
            categoria.id;


          option.textContent =
            categoria.nome;


          novaCategoria.appendChild(
            option
          );

        }
      );


  } catch (erro) {

    console.error(
      'Erro ao carregar categorias:',
      erro
    );


    novaMensagem.textContent =
      erro.message;

  }

}



/* =============================================================
   CADASTRAR
============================================================= */

novoForm.addEventListener(
  'submit',
  async evento => {


    evento.preventDefault();


    const nome =
      novoNome.value.trim();


    const preco =
      Number(
        novoPreco.value
      );


    const categoriaId =
      Number(
        novaCategoria.value
      );


    if (!nome) {

      novaMensagem.textContent =
        'Informe o nome do produto.';

      return;

    }


    if (
      !Number.isFinite(preco) ||
      preco <= 0
    ) {

      novaMensagem.textContent =
        'Informe um preço válido.';

      return;

    }


    if (
      !Number.isInteger(categoriaId) ||
      categoriaId <= 0
    ) {

      novaMensagem.textContent =
        'Selecione uma categoria.';

      return;

    }


    const dadosProduto = {

      nome: nome,

      descricao:
        novaDescricao.value.trim(),

      preco: preco,

      categoria_id:
        categoriaId,

      ativo:
        novoAtivo.checked
          ? 1
          : 0,

      destaque_home:
        novoDestaque.checked
          ? 1
          : 0

    };


    try {

      novaMensagem.classList.remove(
        'sucesso'
      );


      novaMensagem.textContent =
        '';


      novoSalvar.disabled =
        true;


      novoSalvar.textContent =
        'CADASTRANDO...';


      const resposta =
        await fetch(
          `${NOVO_PRODUTO_API}/produtos`,
          {

            method: 'POST',

            headers: {

              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${pegarTokenNovoProduto()}`

            },

            body:
              JSON.stringify(
                dadosProduto
              )

          }
        );


      if (
        tratarAuthNovoProduto(
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
          'Erro ao cadastrar produto.'
        );

      }


      novaMensagem.classList.add(
        'sucesso'
      );


      novaMensagem.textContent =
        'Produto cadastrado com sucesso.';


      /*
        O POST devolve o produto criado,
        incluindo o ID.

        Agora seguimos direto
        para cadastrar as fotos.
      */

      setTimeout(
        () => {

          window.location.href =
            `produto-fotos.html?id=${resultado.id}`;

        },
        700
      );


    } catch (erro) {

      console.error(
        'Erro ao cadastrar produto:',
        erro
      );


      novaMensagem.classList.remove(
        'sucesso'
      );


      novaMensagem.textContent =
        erro.message;


      novoSalvar.disabled =
        false;


      novoSalvar.textContent =
        'CADASTRAR PRODUTO';

    }

  }
);



carregarCategoriasNovoProduto();