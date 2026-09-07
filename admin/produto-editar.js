const EDITAR_API_URL =
  'https://hazedrip-production-6a67.up.railway.app';


const parametrosProduto =
  new URLSearchParams(
    window.location.search
  );

const editarProdutoId =
  Number(
    parametrosProduto.get('id')
  );

const editarForm =
  document.getElementById(
    'editar-produto-form'
  );


const editarNome =
  document.getElementById(
    'editar-nome'
  );


const editarDescricao =
  document.getElementById(
    'editar-descricao'
  );


const editarPreco =
  document.getElementById(
    'editar-preco'
  );


const editarCategoria =
  document.getElementById(
    'editar-categoria'
  );


const editarAtivo =
  document.getElementById(
    'editar-ativo'
  );


const editarDestaque =
  document.getElementById(
    'editar-destaque'
  );


const editarMensagem =
  document.getElementById(
    'editar-produto-mensagem'
  );


const editarSalvar =
  document.getElementById(
    'editar-produto-salvar'
  );



/* =============================================================
   TOKEN
============================================================= */

function pegarTokenAdmin() {

  return sessionStorage.getItem(
    'hazeAdminToken'
  );

}



/* =============================================================
   TRATAR TOKEN EXPIRADO
============================================================= */

function tratarNaoAutorizado(resposta) {

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
   CARREGAR CATEGORIAS
============================================================= */

async function carregarCategoriasEdicao() {

  const token =
    pegarTokenAdmin();


  const resposta =
    await fetch(
      `${EDITAR_API_URL}/admin/categorias`,
      {

        headers: {

          Authorization:
            `Bearer ${token}`

        }

      }
    );


  if (
    tratarNaoAutorizado(resposta)
  ) {
    return [];
  }


  if (!resposta.ok) {

    throw new Error(
      'Não foi possível carregar as categorias.'
    );

  }


  const categorias =
    await resposta.json();


  editarCategoria.innerHTML = '';


  categorias
    .filter(categoria => {

      return (
        Number(categoria.ativo) !== 0
      );

    })
    .forEach(categoria => {


      const option =
        document.createElement(
          'option'
        );


      option.value =
        categoria.id;


      option.textContent =
        categoria.nome;


      editarCategoria.appendChild(
        option
      );


    });


  return categorias;

}



/* =============================================================
   CARREGAR PRODUTO
============================================================= */

async function carregarProdutoEdicao() {


  if (
    !Number.isInteger(editarProdutoId) ||
    editarProdutoId <= 0
  ) {

    editarMensagem.textContent =
      'ID do produto inválido.';

    return;

  }


  try {


    await carregarCategoriasEdicao();

    const token = pegarTokenAdmin();

    const resposta =
      await fetch(
        `${EDITAR_API_URL}/admin/produtos/${editarProdutoId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (
  tratarNaoAutorizado(resposta)
) {
  return;
}


if (!resposta.ok) {

  const erroResposta =
    await resposta.json();

  throw new Error(
    erroResposta.mensagem ||
    'Produto não encontrado.'
  );

}


const produto =
  await resposta.json();



    editarNome.value =
      produto.nome || '';


    editarDescricao.value =
      produto.descricao || '';


    editarPreco.value =
      Number(produto.preco)
        .toFixed(2);


    editarCategoria.value =
      String(produto.categoria_id);


    editarAtivo.checked =
      Number(produto.ativo) !== 0;


    editarDestaque.checked =
      Number(produto.destaque_home) !== 0;



    document.getElementById(
      'editar-produto-id'
    ).textContent =
      `Produto #${produto.id}`;



    document.getElementById(
      'editar-ver-produto'
    ).href =
      `/hazedrip/frontend/produto.html?id=${produto.id}`;



    mostrarFotosProduto(
      produto.imagens || []
    );


  } catch (erro) {


    console.error(
      'Erro ao carregar produto:',
      erro
    );


    editarMensagem.textContent =
      erro.message;


  }

}

/* =============================================================
   MOSTRAR FOTOS
============================================================= */

function mostrarFotosProduto(imagens) {


  const container =
    document.getElementById(
      'editar-preview-fotos'
    );


  container.innerHTML = '';


  if (
    !Array.isArray(imagens) ||
    imagens.length === 0
  ) {

    container.innerHTML = `
      <p class="admin-muted-text">
        Este produto ainda não possui imagens.
      </p>
    `;

    return;

  }


  imagens.forEach(imagem => {


    const item =
      document.createElement(
        'div'
      );


    item.className =
      'admin-edit-image';


    const foto =
      document.createElement(
        'img'
      );


    foto.src =
      imagem.url;


    foto.alt =
      'Foto do produto';


    item.appendChild(
      foto
    );


    if (
      Number(imagem.principal) === 1
    ) {

      const selo =
        document.createElement(
          'span'
        );


      selo.textContent =
        'Principal';


      item.appendChild(
        selo
      );

    }


    container.appendChild(
      item
    );


  });

}



/* =============================================================
   SALVAR PRODUTO
============================================================= */

if (editarForm) {


  editarForm.addEventListener(
    'submit',
    async evento => {


      evento.preventDefault();


      editarMensagem.textContent = '';


      const preco =
        Number(editarPreco.value);


      const categoriaId =
        Number(
          editarCategoria.value
        );


      if (
        !editarNome.value.trim()
      ) {

        editarMensagem.textContent =
          'Informe o nome do produto.';

        return;

      }


      if (
        !Number.isFinite(preco) ||
        preco < 0
      ) {

        editarMensagem.textContent =
          'Informe um preço válido.';

        return;

      }


      if (
        !Number.isInteger(categoriaId) ||
        categoriaId <= 0
      ) {

        editarMensagem.textContent =
          'Selecione uma categoria.';

        return;

      }

const categoriaNome =
  editarCategoria
    .options[
      editarCategoria.selectedIndex
    ]
    ?.textContent
    ?.trim() || '';


      const dadosProduto = {

  nome:
    editarNome.value.trim(),

  descricao:
    editarDescricao.value.trim(),

  preco:
    preco,


  categoria_id:
    categoriaId,

  ativo:
    editarAtivo.checked
      ? 1
      : 0,

  destaque_home:
    editarDestaque.checked
      ? 1
      : 0

};



      try {


        editarSalvar.disabled =
          true;


        editarSalvar.textContent =
          'SALVANDO...';


        const token =
          pegarTokenAdmin();

         console.log(
            'DADOS ENVIADOS:',
             dadosProduto
             ); 

        const resposta =
          await fetch(
            `${EDITAR_API_URL}/produtos/${editarProdutoId}`,
            {

              method: 'PUT',

              headers: {

                'Content-Type':
                  'application/json',

                Authorization:
                  `Bearer ${token}`

              },

              body:
                JSON.stringify(
                  dadosProduto
                )

            }
          );


        if (
          tratarNaoAutorizado(
            resposta
          )
        ) {
          return;
        }

        const textoResposta =
  await resposta.text();


let resultado = {};


try {

  resultado =
    textoResposta
      ? JSON.parse(textoResposta)
      : {};

} catch {

  resultado = {
    mensagem: textoResposta
  };

}


console.log(
  'RESPOSTA DO PUT:',
  resposta.status,
  resultado
);


if (!resposta.ok) {

  throw new Error(
    resultado.erro ||
    resultado.error ||
    resultado.mensagem ||
    resultado.message ||
    `Erro HTTP ${resposta.status}`
  );

}

/* =============================================================
   PRODUTO SALVO, MAS NÃO PODE SER ATIVADO
============================================================= */

if (resultado.aviso) {

  editarAtivo.checked =
    false;


  editarMensagem.classList.remove(
    'sucesso'
  );


  editarMensagem.textContent =
    resultado.aviso;


  editarSalvar.disabled =
    false;


  editarSalvar.textContent =
    'SALVAR ALTERAÇÕES';


  return;

}

        editarMensagem.classList.add(
          'sucesso'
        );


        editarMensagem.textContent =
          'Produto atualizado com sucesso.';


        setTimeout(
          () => {

            window.location.href =
              'produtos.html';

          },
          900
        );


      } catch (erro) {


        console.error(
          'Erro ao atualizar produto:',
          erro
        );


        editarMensagem.classList.remove(
          'sucesso'
        );


        editarMensagem.textContent =
          erro.message;


        editarSalvar.disabled =
          false;


        editarSalvar.textContent =
          'SALVAR ALTERAÇÕES';


      }


    }
  );

}


/* =============================================================
   GERENCIAR FOTOS
============================================================= */

const botaoFotos =
  document.getElementById(
    'editar-gerenciar-fotos'
  );


if (botaoFotos) {

  botaoFotos.addEventListener(
    'click',
    () => {


      window.location.href =
        `produto-fotos.html?id=${editarProdutoId}`;


    }
  );

}

/* =============================================================
   GERENCIAR VARIAÇÕES
============================================================= */

const botaoVariacoes =
  document.getElementById(
    'editar-gerenciar-variacoes'
  );


if (botaoVariacoes) {

  botaoVariacoes.addEventListener(
    'click',
    evento => {

      evento.preventDefault();

      window.location.href =
        `produto-variacoes.html?id=${editarProdutoId}`;

    }
  );

}
/* =============================================================
   INICIAR
============================================================= */

carregarProdutoEdicao();