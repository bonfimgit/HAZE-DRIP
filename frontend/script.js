/*
  Endereço da API.
  - Em localhost/127.0.0.1: API local (npm start no backend)
  - Em produção: API publicada no Railway
  Pode ser sobrescrito definindo window.HAZE_API_URL antes deste arquivo.
*/
const API_URL = window.HAZE_API_URL || (
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://hazedrip-production-6a67.up.railway.app'
);

/*
  Escapa textos antes de inserir em innerHTML.
  Evita que nomes de produto ou dados salvos no navegador
  executem código na página (XSS).
*/
function escaparHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/*
  Imagens do Cloudinary no tamanho certo e em formato automático
  (WebP/AVIF quando o navegador suporta). Outras URLs ficam iguais.
*/
function otimizarImagem(url, largura) {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) {
    return url;
  }
  return url.replace('/upload/', `/upload/f_auto,q_auto,c_limit,w_${largura}/`);
}

function formatarMoeda(valor) {
  return Number(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/*
  Card de produto usado na Home, no catálogo e em "Você também pode gostar".
*/
function criarCardProduto(produto) {

  const card = document.createElement('article');

  card.className = 'card';

  const imagem = produto.imagem_principal
    ? otimizarImagem(produto.imagem_principal, 600)
    : '../assets/haze-logo.webp';

  const nota = produto.avaliacao_total > 0
    ? `<span class="card-nota" aria-label="Nota ${produto.avaliacao_media} de 5">★ ${Number(produto.avaliacao_media).toLocaleString('pt-BR')} <small>(${Number(produto.avaliacao_total)})</small></span>`
    : '';

  const esgotado = produto.estoque_total === 0;

  card.innerHTML = `
    <a class="card-art" href="produto.html?id=${Number(produto.id)}" aria-label="${escaparHtml(produto.nome)}">
      ${produto.promocao
        ? `<span class="selo-promocao">-${Number(produto.promocao.desconto_percentual)}%</span>`
        : ''}
      ${esgotado ? '<span class="selo-esgotado">Esgotado</span>' : ''}
      <img src="${escaparHtml(imagem)}" alt="" loading="lazy" decoding="async" width="600" height="600">
    </a>
    <div class="card-info">
      <a class="card-name" href="produto.html?id=${Number(produto.id)}">${escaparHtml(produto.nome)}</a>
      <span class="card-price mono">
        ${produto.preco_original
          ? `<span class="preco-original">${formatarMoeda(produto.preco_original)}</span>`
          : ''}
        ${formatarMoeda(produto.preco)}
      </span>
      ${nota}
    </div>`;

  return card;
}


async function carregarDestaques() {

  const grid = document.getElementById('destaques-grid');

  // Se não estiver na Home, não executa
  if (!grid) {
    return;
  }

  try {

    const resposta = await fetch(`${API_URL}/produtos/destaques`);

    if (!resposta.ok) {
      throw new Error('Erro ao buscar produtos em destaque');
    }

    const produtos = await resposta.json();

    grid.innerHTML = '';

    if (produtos.length === 0) {
      grid.innerHTML = '<p class="estado-vazio">Nenhum produto em destaque no momento.</p>';
      return;
    }

    produtos.forEach(produto => grid.appendChild(criarCardProduto(produto)));

  } catch (erro) {

    console.error('Erro ao carregar destaques:', erro);

    grid.innerHTML = `
      <div class="estado-erro">
        <p>Não foi possível carregar os destaques.</p>
        <button type="button" class="btn" onclick="carregarDestaques()">Tentar de novo</button>
      </div>`;
  }
}


carregarDestaques();

/* =============================================================
   CAMPANHA DA HOME
============================================================= */

async function carregarCampanhaHome() {

  const titulo =
    document.getElementById(
      'home-campanha-titulo'
    );


  /*
    Se não estamos na Home,
    não executa.
  */

  if (!titulo) {
    return;
  }


  const subtitulo =
    document.getElementById(
      'home-campanha-subtitulo'
    );


  const botao =
    document.getElementById(
      'home-campanha-botao'
    );


  const imagem =
    document.getElementById(
      'home-campanha-imagem'
    );


  try {

    const resposta =
      await fetch(
        `${API_URL}/campanha`
      );


    /*
      Nenhuma campanha ativa:
      mantém o conteúdo padrão do HTML.
    */

    if (resposta.status === 404) {
      return;
    }


    if (!resposta.ok) {

      throw new Error(
        'Erro ao carregar campanha'
      );

    }


    const campanha =
      await resposta.json();



    if (campanha.titulo) {

      titulo.textContent =
        campanha.titulo;

    }



    if (campanha.subtitulo) {

      subtitulo.textContent =
        campanha.subtitulo;

    }



    if (campanha.texto_botao) {

      botao.textContent =
        campanha.texto_botao;

    }



    if (campanha.link_botao) {

      botao.href =
        campanha.link_botao;

    }



    if (campanha.imagem_url) {

      imagem.src =
        campanha.imagem_url;


      imagem.classList.add(
        'carregada'
      );

    }


  } catch (erro) {

    console.error(
      'Erro ao carregar campanha da Home:',
      erro
    );

  }

}



carregarCampanhaHome();


const burger = document.querySelector('.nav-burger');
const navLinks = document.querySelector('.nav-links');
if(burger){
  burger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => navLinks.classList.remove('open'))
  );
}


/* =============================================================
   2d) CATÁLOGO — FAVORITAR PRODUTO (coração)
   -------------------------------------------------------------
   Alterna a classe "active" no botão de coração de cada card.
   -----------------------------------------------------------
   PENDENTE (Etapa "Área do cliente" - backend): hoje o favorito
   não é salvo em lugar nenhum — some ao recarregar a página.
   Quando existir login de usuário, isso deve virar uma chamada
   à API pra guardar a lista de favoritos no banco de dados.
============================================================= */
document.querySelectorAll('.card-fav').forEach(fav => {
  fav.addEventListener('click', (e) => {
    e.preventDefault(); // evita que o clique "vaze" pro link do card, se houver um por cima
    fav.classList.toggle('active');
  });
});


/* =============================================================
   3) PÁGINA DE PRODUTO — SELETOR DE TAMANHO
   -------------------------------------------------------------
   Ao clicar num botão de tamanho (P/M/G/GG), remove o destaque
   dos outros botões do mesmo grupo e destaca só o clicado.
   Tamanhos com o atributo "disabled" (sem estoque) não recebem
   o clique, por isso o :not(:disabled) no seletor.
============================================================= */
document.querySelectorAll('.size-btn:not(:disabled)').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.parentElement.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});
/* Botão de favorito ao lado do "Adicionar ao carrinho" na página de produto */
document.querySelectorAll('.wishlist-btn').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});


/* =============================================================
   4) PÁGINA DE PRODUTO — SELETOR DE COR (SWATCH)
   -------------------------------------------------------------
   Mesma lógica do seletor de tamanho, mas pra bolinhas de cor.
============================================================= */
document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    sw.parentElement.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });
});


/* =============================================================
   5) PÁGINA DE PRODUTO — MINIATURAS DA GALERIA
   -------------------------------------------------------------
   Ao clicar numa miniatura, copia o SVG/imagem de dentro dela
   pra área principal da galeria (.product-gallery) e marca a
   miniatura clicada como ativa (borda de destaque via CSS).
============================================================= */
document.querySelectorAll('.product-thumbs > div').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.product-thumbs > div').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const svgHTML = t.querySelector('svg').outerHTML;
    const gallery = document.querySelector('.product-gallery');
    gallery.innerHTML = svgHTML;
  });
});


/* =============================================================
   6) PÁGINA DE PRODUTO — CONTADOR DE QUANTIDADE
   -------------------------------------------------------------
   Botões "−" e "+" ao lado do número de unidades. Trava o
   mínimo em 1 e o máximo em 9 (ajuste esses números aqui se
   precisar de outro limite).
============================================================= */
const qtyEl = document.querySelector('.qty span');
if(qtyEl){
  let qty = 1;
  document.querySelector('.qty .minus').addEventListener('click', () => {
    qty = Math.max(1, qty - 1);
    qtyEl.textContent = qty;
  });
  document.querySelector('.qty .plus-qty').addEventListener('click', () => {
    qty = Math.min(9, qty + 1);
    qtyEl.textContent = qty;
  });
}


/* =============================================================
   7) PÁGINA DE PRODUTO — ADICIONAR AO CARRINHO
   -------------------------------------------------------------
   Por enquanto isso é só uma simulação visual: troca o texto do
   botão pra "ADICIONADO ✓" por 1.6s e soma +1 no número do
   ícone de carrinho no menu (.js-cart-count).
   -----------------------------------------------------------
   PENDENTE (Etapa 8/9 - backend): trocar este bloco por uma
   chamada real, por exemplo:
     fetch('/api/carrinho', { method:'POST', body: JSON.stringify({...}) })
   e atualizar o contador com a resposta do servidor, não só
   somando localmente.
============================================================= */
const addBtn = document.querySelector('.js-add-cart');

if (addBtn) {

  addBtn.addEventListener('click', () => {

    const variacaoId = Number(
      addBtn.dataset.variacaoId
    );

    if (!variacaoId) {
      return;
    }


    const produtoId = Number(
      new URLSearchParams(
        window.location.search
      ).get('id')
    );


    const nome = document.getElementById(
      'produto-nome'
    ).textContent;


    const preco = Number(
      document.getElementById('produto-preco').dataset.preco
    );


    const quantidade = Number(
      document.querySelector('.qty span').textContent
    );


    const estoque = Number(
      addBtn.dataset.estoque
    );


    if (quantidade > estoque) {

      alert(
        `Existem apenas ${estoque} unidade(s) disponíveis.`
      );

      return;
    }


    const imagem =
      document.querySelector(
        '#produto-galeria img'
      )?.src || '';


    const item = {

      produtoId: produtoId,

      variacaoId: variacaoId,

      nome: nome,

      preco: preco,

      cor: addBtn.dataset.cor,

      tamanho: addBtn.dataset.tamanho,

      quantidade: quantidade,

      imagem: imagem,

      estoque: estoque
    };


    const carrinho = JSON.parse(
      localStorage.getItem('hazeCarrinho')
    ) || [];


    const existente = carrinho.find(
      produto =>
        produto.variacaoId === variacaoId
    );


    if (existente) {

      const novaQuantidade =
        existente.quantidade + quantidade;


      if (novaQuantidade > estoque) {

        alert(
          `Você já possui unidades deste produto no carrinho. Estoque máximo: ${estoque}.`
        );

        return;
      }


      existente.quantidade =
        novaQuantidade;

    } else {

      carrinho.push(item);
    }


    salvarCarrinho(carrinho);


    atualizarContadorCarrinho();


    const textoOriginal =
      addBtn.textContent;

    addBtn.textContent =
      'ADICIONADO ✓';

    setTimeout(() => {

      addBtn.textContent =
        textoOriginal;

    }, 1600);

  });
}

/*
  Grava a sacola no navegador e avisa a sincronização com a conta
  do cliente (cliente.js), quando houver login.
*/
function salvarCarrinho(carrinho) {

  localStorage.setItem(
    'hazeCarrinho',
    JSON.stringify(carrinho)
  );

  window.HazeCliente?.carrinhoAlterado?.();
}

//contador
function atualizarContadorCarrinho() {

  const carrinho = JSON.parse(
    localStorage.getItem('hazeCarrinho')
  ) || [];


  const quantidadeTotal =
    carrinho.reduce(
      (total, item) =>
        total + Number(item.quantidade),
      0
    );


  document
    .querySelectorAll('.js-cart-count')
    .forEach(contador => {

      contador.textContent =
        quantidadeTotal;

    });
}


atualizarContadorCarrinho();


/* =============================================================
   8) ACORDEÃO (Descrição / Detalhes / Guia de medidas...)
   -------------------------------------------------------------
   Cada item começa fechado (ou aberto, se já tiver a classe
   "open" no HTML). Clicar no cabeçalho alterna aberto/fechado.
   O CSS controla a altura/animação via max-height.
============================================================= */
document.querySelectorAll('.accordion-head').forEach(head => {
  head.addEventListener('click', () => {
    head.parentElement.classList.toggle('open');
  });
});


/* =============================================================
   10) NEWSLETTER — ENVIO DO FORMULÁRIO
   -------------------------------------------------------------
   e.preventDefault() evita que a página recarregue ao enviar o
   formulário (comportamento padrão do HTML). Por enquanto só
   mostra "FEITO ✓" no botão e limpa o campo de e-mail.
   -----------------------------------------------------------
   PENDENTE (Etapa 8 - backend): enviar o e-mail digitado pra
   uma rota da API (ex: POST /api/newsletter) que salva no banco.
============================================================= */
const newsForm = document.querySelector('.js-newsletter');
if(newsForm){
  newsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = newsForm.querySelector('button');
    const original = btn.textContent;
    btn.textContent = 'FEITO ✓';
    newsForm.querySelector('input').value = '';
    setTimeout(() => btn.textContent = original, 1800);
  });
}

/*=========pagina galeria de imagens ========= */
function montarGaleriaProduto(imagens, nomeProduto) {

    const galeria = document.getElementById('produto-galeria');
    const miniaturas = document.getElementById('produto-miniaturas');

    if (!galeria || !miniaturas) return;

    galeria.innerHTML = '';
    miniaturas.innerHTML = '';

    if (!imagens || imagens.length === 0) {

        const fallback = document.createElement('img');

        fallback.src = '../assets/haze-logo.webp';
        fallback.alt = nomeProduto;

        galeria.appendChild(fallback);

        return;
    }


    const imagensOrdenadas = [...imagens].sort((a, b) => {

        if (Number(a.principal) !== Number(b.principal)) {
            return Number(b.principal) - Number(a.principal);
        }

        return Number(a.ordem || 0) - Number(b.ordem || 0);
    });


    function mostrarImagem(imagem) {

        galeria.innerHTML = '';

        const foto = document.createElement('img');

        foto.src = otimizarImagem(imagem.url, 1200);
        foto.decoding = 'async';
        foto.alt = nomeProduto;

        galeria.appendChild(foto);
    }


    mostrarImagem(imagensOrdenadas[0]);


    imagensOrdenadas.forEach((imagem, index) => {

        const botao = document.createElement('button');

        botao.type = 'button';
        botao.className = 'product-thumb';

        if (index === 0) {
            botao.classList.add('active');
        }


        const foto = document.createElement('img');

        foto.src = otimizarImagem(imagem.url, 200);
        foto.loading = 'lazy';
        foto.alt = `${nomeProduto} - imagem ${index + 1}`;


        botao.appendChild(foto);


        botao.addEventListener('click', () => {

            miniaturas
                .querySelectorAll('.product-thumb')
                .forEach(item => {
                    item.classList.remove('active');
                });

            botao.classList.add('active');

            mostrarImagem(imagem);
        });


        miniaturas.appendChild(botao);
    });
}

async function carregarVariacoesProduto(produtoId) {

  const coresEl = document.getElementById('produto-cores');
  const tamanhosEl = document.getElementById('produto-tamanhos');
  const estoqueEl = document.getElementById('produto-estoque');
  const adicionarBtn = document.querySelector('.js-add-cart');

  if (!coresEl || !tamanhosEl || !estoqueEl) return;

  try {

    const resposta = await fetch(
      `${API_URL}/produtos/${produtoId}/variacoes`
    );

    if (!resposta.ok) {
      throw new Error('Erro ao carregar variações');
    }

    const variacoes = await resposta.json();

    coresEl.innerHTML = '';
    tamanhosEl.innerHTML = '';

    if (variacoes.length === 0) {
      estoqueEl.textContent = 'Produto indisponível';
      if (adicionarBtn) adicionarBtn.disabled = true;
      return;
    }

    const cores = [...new Set(
      variacoes.map(variacao => variacao.cor)
    )];

    const mapaCores = {
  preto: '#111111',
  branco: '#f5f5f5',
  cinza: '#777777',
  vermelho: '#b91c1c',
  azul: '#1d4ed8',
  marinho: '#172554',
  verde: '#166534',
  bege: '#d6c2a1'
};

function obterCorCss(nomeCor) {

  const chave = nomeCor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return mapaCores[chave] || '#777777';
}

const nomeCorSelecionada = document.createElement('span');

nomeCorSelecionada.className = 'produto-cor-atual';
nomeCorSelecionada.textContent = cores[0];


const listaCores = document.createElement('div');

listaCores.className = 'swatches';


coresEl.appendChild(nomeCorSelecionada);
coresEl.appendChild(listaCores);


cores.forEach((cor, index) => {

  const botaoCor = document.createElement('button');

  botaoCor.type = 'button';
  botaoCor.className = 'swatch';

  botaoCor.style.backgroundColor =
    obterCorCss(cor);

  botaoCor.title = cor;

  botaoCor.setAttribute(
    'aria-label',
    `Selecionar cor ${cor}`
  );


  if (index === 0) {
    botaoCor.classList.add('active');
  }


  botaoCor.addEventListener('click', () => {

    listaCores
      .querySelectorAll('.swatch')
      .forEach(btn => {
        btn.classList.remove('active');
      });


    botaoCor.classList.add('active');

    nomeCorSelecionada.textContent = cor;

    montarTamanhos(cor);
  });


  listaCores.appendChild(botaoCor);
});
    


    function montarTamanhos(corSelecionada) {

      tamanhosEl.innerHTML = '';

      const variacoesDaCor = variacoes.filter(
        variacao => variacao.cor === corSelecionada
      );

      variacoesDaCor.forEach(variacao => {

        const botaoTamanho = document.createElement('button');

        botaoTamanho.type = 'button';
        botaoTamanho.className = 'size-btn';
        botaoTamanho.textContent = variacao.tamanho;

        if (Number(variacao.estoque) <= 0) {
          botaoTamanho.disabled = true;
        }

        botaoTamanho.addEventListener('click', () => {

          tamanhosEl
            .querySelectorAll('.size-btn')
            .forEach(btn => btn.classList.remove('active'));

          botaoTamanho.classList.add('active');

          estoqueEl.textContent =
            `${variacao.estoque} unidade(s) disponível(is)`;

          if (adicionarBtn) {
            adicionarBtn.disabled = false;

            adicionarBtn.dataset.variacaoId = variacao.id;
            adicionarBtn.dataset.cor = variacao.cor;
            adicionarBtn.dataset.tamanho = variacao.tamanho;
            adicionarBtn.dataset.estoque = variacao.estoque;
          }
        });

        tamanhosEl.appendChild(botaoTamanho);
      });

      estoqueEl.textContent = 'Selecione um tamanho';

      if (adicionarBtn) {
        adicionarBtn.disabled = true;
      }
    }


    montarTamanhos(cores[0]);

  } catch (erro) {

    console.error(
      'Erro ao carregar variações:',
      erro
    );

    estoqueEl.textContent =
      'Não foi possível verificar o estoque';
  }
}

/* =============================================================
   PÁGINA DE PRODUTO — CARREGAR DADOS
============================================================= */
async function carregarProduto() {

  const nomeEl = document.getElementById('produto-nome');

  /*
   Se produto-nome não existe, significa que estamos
   na Home ou no Catálogo. Então a função para aqui.
  */
  if (!nomeEl) {
    return;
  }


  /*
   Pega os parâmetros da URL.

   Exemplo:
   produto.html?id=3

   produtoId receberá 3.
  */
  const parametros = new URLSearchParams(
    window.location.search
  );

  const produtoId = Number(
    parametros.get('id')
  );


  /*
   Validação do ID.
  */
  if (!Number.isInteger(produtoId) || produtoId <= 0) {

    nomeEl.textContent = 'Produto não encontrado';

    document.getElementById(
      'produto-descricao'
    ).textContent =
      'Nenhum produto foi selecionado.';

    return;
  }


  try {

    /*
     Busca o produto no backend.
    */
    const resposta = await fetch(
      `${API_URL}/produtos/${produtoId}`
    );


    /*
     Se o servidor responder 404, 500 etc.
    */
    if (!resposta.ok) {
      throw new Error(
        'Não foi possível carregar o produto'
      );
    }


    /*
     Converte a resposta para objeto JavaScript.
    */
    const produto = await resposta.json();


    /* =========================================
       NOME
    ========================================== */

    document.getElementById(
      'produto-nome'
    ).textContent = produto.nome;


    /* =========================================
       CATEGORIA
    ========================================== */

    document.getElementById(
      'produto-categoria'
    ).textContent =
      produto.categoria_nome || 'HAZE DRIP';


    /* =========================================
       DESCRIÇÃO
    ========================================== */

    const descricao =
      produto.descricao ||
      'Produto Haze Drip.';


    document.getElementById(
      'produto-descricao'
    ).textContent = descricao;


    document.getElementById(
      'produto-descricao-completa'
    ).textContent = descricao;


    /* =========================================
       PREÇO
    ========================================== */

    const preco = Number(produto.preco);

    const precoEl =
      document.getElementById('produto-preco');

    // Preço efetivo guardado no elemento (usado ao adicionar à sacola)
    precoEl.dataset.preco = preco;

    precoEl.innerHTML = produto.preco_original
      ? `<span class="preco-original">${formatarMoeda(produto.preco_original)}</span>${formatarMoeda(preco)}`
      : formatarMoeda(preco);


    /* =========================================
       PARCELAMENTO
    ========================================== */

    const valorParcela = preco / 6;


    document.getElementById(
      'produto-parcelamento'
    ).textContent =
      `6x de ${
        valorParcela.toLocaleString(
          'pt-BR',
          {
            style: 'currency',
            currency: 'BRL'
          }
        )
      } sem juros`;


    /* =========================================
       BREADCRUMB
    ========================================== */

    document.getElementById(
      'produto-breadcrumb'
    ).textContent = produto.nome;


    /* =========================================
       TÍTULO DA ABA DO NAVEGADOR
    ========================================== */

    document.title =
      `${produto.nome} — Haze Drip`;


    /* galeria de imagens */
    montarGaleriaProduto(produto.imagens || [],produto.nome);

    await carregarVariacoesProduto(produtoId);

    console.log(
      'Produto carregado:',
      produto
    );

  } catch (erro) {

    console.error(
      'Erro ao carregar produto:',
      erro
    );


    nomeEl.textContent =
      'Produto não encontrado';


    document.getElementById(
      'produto-descricao'
    ).textContent =
      'Não foi possível carregar este produto.';

  }

}


/*
Executa quando a página abre.
*/
carregarProduto();
function carregarSacola() {

  const container =
    document.getElementById('sacola-itens');

  if (!container) {
    return;
  }


  const carrinho = JSON.parse(
    localStorage.getItem('hazeCarrinho')
  ) || [];


  const subtotalEl =
    document.getElementById('sacola-subtotal');

  const totalEl =
    document.getElementById('sacola-total');


  if (carrinho.length === 0) {

    container.innerHTML = `
      <div class="sacola-vazia">

        <h2>Sua sacola está vazia</h2>

        <p>
          Explore os drops da Haze e encontre sua próxima peça.
        </p>

        <a
          href="catalogo.html"
          class="btn"
        >
          Ver catálogo
        </a>

      </div>
    `;

    subtotalEl.textContent = 'R$ 0,00';
    totalEl.textContent = 'R$ 0,00';

    return;
  }


  container.innerHTML = '';


  let total = 0;

  let temIndisponivel = false;


  carrinho.forEach((item, index) => {

    // Item marcado pela API como esgotado/inativo não entra no total
    const disponivel = item.disponivel !== false;

    if (!disponivel) {
      temIndisponivel = true;
    }

    const subtotal = disponivel
      ? Number(item.preco) * Number(item.quantidade)
      : 0;


    total += subtotal;


    const artigo =
      document.createElement('article');


    artigo.className = disponivel
      ? 'sacola-item'
      : 'sacola-item sacola-item-indisponivel';


    artigo.innerHTML = `

      <div class="sacola-item-imagem">

        <img
          src="${escaparHtml(item.imagem || '../assets/haze-logo.webp')}"
          alt="${escaparHtml(item.nome)}"
        >

      </div>


      <div class="sacola-item-info">

        <h3>
          ${escaparHtml(item.nome)}
        </h3>

        <p>
          Cor: ${escaparHtml(item.cor)}
        </p>

        <p>
          Tamanho: ${escaparHtml(item.tamanho)}
        </p>

        ${
          item.aviso
            ? `<p class="sacola-aviso">${escaparHtml(item.aviso)}</p>`
            : ''
        }

        <p class="sacola-estoque">
  ${
    Number(item.estoque) === 1
      ? 'Última unidade disponível'
      : `${Number(item.estoque)} unidades disponíveis`
  }
</p>

        <div class="sacola-quantidade">

  <button
    type="button"
    class="sacola-menos"
    aria-label="Diminuir quantidade"
  >
    −
  </button>

  <span>
    ${Number(item.quantidade)}
  </span>

  <button
  type="button"
  class="sacola-mais"
  aria-label="Aumentar quantidade"
  ${
    Number(item.quantidade) >= Number(item.estoque)
      ? 'disabled'
      : ''
  }
>
  +
</button>

</div>

<button
  type="button"
  class="sacola-remover"
>
  Remover
</button>

      </div>


      <div class="sacola-item-preco">

        <strong>
          ${
            subtotal.toLocaleString(
              'pt-BR',
              {
                style: 'currency',
                currency: 'BRL'
              }
            )
          }
        </strong>

        <small>
          ${
            Number(item.preco)
              .toLocaleString(
                'pt-BR',
                {
                  style: 'currency',
                  currency: 'BRL'
                }
              )
          }
          cada
        </small>

      </div>

    `;
    const botaoMenos =
  artigo.querySelector('.sacola-menos');

const botaoMais =
  artigo.querySelector('.sacola-mais');

const botaoRemover =
  artigo.querySelector('.sacola-remover');


botaoMenos.addEventListener('click', () => {

  if (item.quantidade > 1) {

    carrinho[index].quantidade--;

    salvarCarrinho(carrinho);

    atualizarContadorCarrinho();
    carregarSacola();
  }

});


botaoMais.addEventListener('click', () => {

  const estoqueMaximo =
    Number(item.estoque || 99);


  if (item.quantidade >= estoqueMaximo) {
    return;
  }


  carrinho[index].quantidade++;


  salvarCarrinho(carrinho);


  atualizarContadorCarrinho();
  carregarSacola();

});


botaoRemover.addEventListener('click', () => {

  carrinho.splice(index, 1);


  salvarCarrinho(carrinho);


  atualizarContadorCarrinho();
  carregarSacola();

});


    container.appendChild(artigo);

  });


  const totalFormatado =
    total.toLocaleString(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    );


  subtotalEl.textContent =
    totalFormatado;

  totalEl.textContent =
    totalFormatado;


  // Não deixa seguir para o checkout com item esgotado/indisponível
  const finalizar =
    document.querySelector('.sacola-finalizar');

  if (finalizar) {

    finalizar.classList.toggle('desativado', temIndisponivel);

    finalizar.setAttribute('aria-disabled', temIndisponivel ? 'true' : 'false');

    finalizar.onclick = temIndisponivel
      ? evento => {
          evento.preventDefault();
          alert('Remova os itens indisponíveis da sacola para continuar.');
        }
      : null;
  }
}


carregarSacola();

/*
  Checkout e confirmação do pedido ficam em checkout.js
  e pedido-confirmado.js (carregados só nessas páginas).
*/