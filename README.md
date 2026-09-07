\# Haze Drip — E-commerce Full Stack



E-commerce de streetwear desenvolvido do zero como projeto Full Stack, com loja virtual, painel administrativo, API REST, autenticação, gerenciamento de produtos, controle de estoque e fluxo completo de pedidos.



O projeto foi criado para aplicar na prática conhecimentos adquiridos durante minha formação em \*\*Sistemas de Informação\*\* e meus estudos em desenvolvimento web.



> 🚀 \*\*Status:\*\* MVP funcional publicado e em evolução.



\## 🌐 Demonstração



\*\*Loja:\*\*  

\[Ver Haze Drip online] https://6a9ed0deee28f68217553dad--ubiquitous-squirrel-39e709.netlify.app/hazedrip/frontend/



\*\*Painel administrativo:\*\*  

Possui autenticação própria e não disponibilizo credenciais publicamente.



\## 🎯 Principais desafios implementados



\- Desenvolvimento de uma API REST com Node.js e Express

\- Integração entre frontend, backend e banco MySQL

\- Autenticação administrativa utilizando JWT

\- Modelagem de produtos com imagens, cores, tamanhos e estoque

\- Controle transacional de pedidos

\- Baixa automática de estoque após compras

\- Reposição de estoque após cancelamentos válidos

\- Controle do fluxo de status dos pedidos

\- Upload e gerenciamento de imagens com Cloudinary

\- Deploy separado de frontend, backend e banco de dados





\## Fluxo de pedidos



O sistema possui controle do ciclo de vida dos pedidos:



```text

Aguardando pagamento

&#x20;       ↓

Pago

&#x20;       ↓

Em preparação

&#x20;       ↓

Enviado

&#x20;       ↓

Entregue

Pedidos elegíveis também podem ser cancelados, com devolução automática dos produtos ao estoque.



Controle de estoque



Durante a criação de um pedido, o backend:



Valida a existência das variações.

Verifica o estoque disponível.

Calcula os valores do pedido.

Registra o pedido e seus itens.

Atualiza o estoque.

Executa as operações dentro de uma transação no banco de dados.



Isso evita que um pedido seja criado parcialmente caso alguma etapa falhe.



\## 🛠️ Tecnologias utilizadas



\### Frontend

\- HTML5

\- CSS3

\- JavaScript

\- Bootstrap no painel administrativo



\### Backend

\- Node.js

\- Express.js

\- API REST

\- JWT para autenticação



\### Banco de dados

\- MySQL

\- Transações

\- Relacionamentos entre produtos, variações, imagens e pedidos



\### Infraestrutura e serviços

\- Railway — API e banco de dados

\- Netlify — frontend e painel administrativo

\- Cloudinary — armazenamento de imagens



\### Ferramentas

\- Git

\- GitHub

\- Visual Studio Code

\- PowerShell




Arquitetura

Cliente

&#x20;  │

&#x20;  ▼

Frontend / Netlify

&#x20;  │

&#x20;  │ HTTP / REST

&#x20;  ▼

Node.js + Express / Railway

&#x20;  │

&#x20;  ├──────────► Cloudinary

&#x20;  │             Imagens

&#x20;  │

&#x20;  ▼

MySQL / Railway

O frontend consome uma API REST responsável pelas regras de negócio e comunicação com o banco de dados.

Estrutura do projeto

haze-drip/

│

├── admin/

│   └── Painel administrativo

│

├── assets/

│   └── Arquivos estáticos

│

├── backend/

│   ├── server.js

│   ├── db.js

│   ├── cloudinary.js

│   ├── package.json

│   └── .env.example

│

├── frontend/

│   ├── index.html

│   ├── catalogo.html

│   ├── produto.html

│   ├── sacola.html

│   ├── checkout.html

│   └── pedido-confirmado.html

│

└── README.md

Executando o backend localmente

Clone o repositório:
git clone: https://github.com/bonfimgit/HAZE-DRIP

Entre na pasta:

cd Haze-Drip-Portfolio/backend



Instale as dependências:

npm install



Crie o arquivo .env utilizando .env.example como referência.

NODE\_ENV=development

PORT=3000



DB\_HOST=localhost

DB\_PORT=3306

DB\_USER=seu\_usuario

DB\_PASSWORD=sua\_senha

DB\_NAME=haze\_drip



JWT\_SECRET=adicione\_um\_segredo\_seguro\_aqui



CLOUDINARY\_CLOUD\_NAME=seu\_cloud\_name

CLOUDINARY\_API\_KEY=sua\_api\_key

CLOUDINARY\_API\_SECRET=seu\_api\_secret



FRONTEND\_URLS=http://127.0.0.1:5500,http://localhost:5500



Depois execute:

npm start



Segurança



Informações sensíveis não são armazenadas no repositório.



Arquivos como:



.env

node\_modules/

uploads/

arquivos SQL



são ignorados pelo Git.



As configurações necessárias estão documentadas em: backend/.env.example



Deploy



A versão MVP foi publicada utilizando:



Netlify para o frontend e painel administrativo

Railway para API e banco MySQL

Cloudinary para armazenamento de imagens



Demonstração



Loja online: https://6a9ed0deee28f68217553dad--ubiquitous-squirrel-39e709.netlify.app/hazedrip/frontend/

O painel administrativo possui autenticação e seu acesso não é disponibilizado publicamente.

Status do projeto



✅ MVP concluído

✅Loja virtual

✅ API REST

✅ Banco de dados

✅ Autenticação administrativa

✅ CRUD de produtos

✅ Imagens

✅ Variações

✅ Controle de estoque

✅ Checkout

✅ Pedidos

✅ Fluxo de status

✅ Deploy


\## 🔭 Próximas melhorias



\- \[ ] Integração com gateway de pagamento

\- \[ ] Recuperação de senha

\- \[ ] Testes automatizados

\- \[ ] Validação e documentação mais completa da API

\- \[ ] Melhorias de acessibilidade

\- \[ ] Melhorias de responsividade e UX

\- \[ ] Logs e monitoramento

\- \[ ] Refatoração gradual da arquitetura do backend

## 📸 Screenshots



\### Loja — Página inicial



!\[Home da Haze Drip](screenshots/home.png)



\### Loja — Página de produto



!\[Página de produto da Haze Drip](screenshots/produto.png)



\### Painel administrativo — Produtos



!\[Gerenciamento de produtos](screenshots/admin-produtos.png)



\### Painel administrativo — Pedidos



!\[Gerenciamento de pedidos](screenshots/admin-pedidos.png)



Objetivo acadêmico e profissional



Este projeto faz parte do meu processo de formação em Sistemas de Informação e desenvolvimento Full Stack.



A Haze Drip foi utilizada para colocar em prática conceitos de:



desenvolvimento frontend;

criação de APIs REST;

modelagem e manipulação de banco de dados;

autenticação;

regras de negócio;

controle de estoque;

transações;

Git e versionamento;

deploy e configuração de ambientes.



\## 👨‍💻 Autor



\*\*João Victor Silva Bonfim Santos\*\*



Estudante de \*\*Sistemas de Informação\*\* e desenvolvedor Full Stack em formação.



Atualmente estou buscando minha primeira oportunidade profissional na área de desenvolvimento de software, onde possa continuar evoluindo e contribuir com projetos reais.



\### Áreas de interesse



\- Desenvolvimento Full Stack

\- Desenvolvimento Backend

\- Node.js

\- JavaScript

\- APIs REST

\- Banco de Dados

\- Desenvolvimento Web



📍 Passos — MG, Brasil

