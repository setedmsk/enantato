# Backend gratuito na Cloudflare

Este diretório publica o backend central do Enantato em **Cloudflare Workers + Durable Objects com armazenamento SQLite**. Ele mantém contas, sessões, perfis e mensagens persistentes e usa WebSockets hibernáveis para presença, chat e sinalização WebRTC.

O compartilhamento de tela continua sendo ponto a ponto entre os amigos. O Worker coordena a conexão; o vídeo não atravessa o armazenamento do servidor.

## O que é necessário uma única vez

1. Crie ou acesse uma conta gratuita em [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Em **My Profile > API Tokens**, crie um token usando o modelo **Edit Cloudflare Workers**.
3. Copie o **Account ID** exibido na página inicial da conta Cloudflare.
4. No GitHub, abra **Settings > Secrets and variables > Actions** e crie:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Em **Actions > Deploy Cloudflare backend**, escolha **Run workflow**.

A execução exibirá uma URL parecida com:

`https://enantato-server.<seu-subdominio>.workers.dev`

## Ligar o site ao backend

Edite `runtime-config.js`:

```js
window.ENANTATO_CONFIG = Object.freeze({
  serverUrl: 'https://enantato-server.<seu-subdominio>.workers.dev'
});
```

Depois do merge na `main`, o GitHub Pages publicará essa configuração. Quem abrir o site já receberá o servidor correto, sem preencher endereço manualmente.

## Configuração

- `APP_ORIGINS`: origens web permitidas, separadas por vírgula.
- `ICE_SERVERS`: array JSON com servidores STUN/TURN usados pelo WebRTC.
- `ENANTATO`: Durable Object único que serializa operações e persiste o estado.

Por padrão, o GitHub Pages em `https://setedmsk.github.io` e acessos locais de desenvolvimento são aceitos.

## Segurança operacional

Nunca coloque o token da Cloudflare no repositório. Os dois valores ficam apenas nos Secrets do GitHub. O deploy é manual, então a workflow não falha enquanto a conta ainda não estiver conectada.
