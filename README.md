# Enantato

Uma plataforma privada para grupos de amigos conversarem, personalizarem perfis e compartilharem tela com WebRTC. O cliente usa uma identidade visual preta e vermelha e pode ser instalado como PWA ou aplicativo Windows.

## O que funciona

- criação de conta e login com senha;
- sessões e dados persistentes no servidor;
- perfis com nome, emoji, status, bio, avatar GIF e banner GIF por URL;
- mensagens persistentes separadas por canal;
- presença online em tempo real;
- sinalização WebRTC por WebSocket;
- compartilhamento de aba, janela ou monitor;
- perfis de captura de 720p30 até 4K60, conforme navegador, tela e conexão;
- instalação como PWA;
- instalador Windows compilado remotamente com Tauri;
- validação automática do cliente, servidor Node, Worker Cloudflare, Docker e desktop.

## Abrir no computador de cada amigo

A versão web fica em:

[https://setedmsk.github.io/enantato/](https://setedmsk.github.io/enantato/)

No Chrome ou Edge, use o botão **Instalar** para abrir o Enantato como um aplicativo separado. Cada amigo cria o próprio usuário e escolhe seu perfil.

Para gerar o instalador Windows, crie uma versão `app-v*`. A workflow `Desktop release` compila tudo nos servidores do GitHub e cria um Release rascunho com o instalador NSIS. Nenhum build precisa ser feito no computador local.

## Backend central gratuito

O backend recomendado está em `cloudflare/` e usa Cloudflare Workers, Durable Objects, armazenamento persistente e WebSockets hibernáveis. O servidor Node em `server/` continua disponível como alternativa Docker/self-hosted.

A configuração completa está em [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

Depois do primeiro deploy, coloque a URL `workers.dev` em `runtime-config.js`. O site e o aplicativo Windows passarão a usar o mesmo servidor automaticamente.

## Estrutura

```text
index.html                         interface
styles.css                        identidade visual
app.js                            UI, perfil e captura de tela
realtime.js                       autenticação, chat, WebSocket e WebRTC
runtime-config.js                 endereço público do backend
cloudflare/src/worker.js          backend gratuito central
cloudflare/wrangler.jsonc         configuração Cloudflare
server/                            backend Node/Docker alternativo
src-tauri/                         aplicativo e instalador Windows
.github/workflows/                qualidade, deploy e releases
docs/                              arquitetura e operação
```

## Privacidade

Senhas são derivadas antes de serem armazenadas. Tokens da Cloudflare e outros segredos ficam somente nos Secrets do GitHub e nunca devem ser adicionados ao repositório. O compartilhamento de tela é ponto a ponto; apenas a sinalização da conexão passa pelo backend.
