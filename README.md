# Enantato

Uma plataforma privada para grupos de amigos conversarem, organizarem comunidades e compartilharem tela com alta qualidade.

> Primeira entrega em desenvolvimento. A interface desta branch já é navegável; voz e transmissão multiusuário serão conectadas à infraestrutura WebRTC nas próximas etapas.

## O que funciona nesta entrega

- entrada com nome e emoji de status;
- perfil persistente com avatar GIF, banner GIF, bio e status;
- navegação entre servidores, canais de texto e salas de voz;
- mensagens locais separadas por canal;
- captura real de aba, janela ou monitor;
- opções de 720p30, 1080p60, 1440p60 e 4K60;
- layout responsivo;
- instalação como PWA e shell offline;
- validação automática do JavaScript no GitHub Actions.

## Como cada amigo instala

### Aplicativo web

Depois da publicação HTTPS, cada pessoa abre o endereço no Chrome ou Edge e usa o botão **Instalar**. O Enantato passa a aparecer no menu Iniciar e abre em uma janela própria. As atualizações do frontend são automáticas.

### Aplicativo Windows

O workflow `Desktop release` compila o mesmo cliente com Tauri em um servidor Windows do GitHub Actions. Ele gera um instalador NSIS para o usuário atual, sem exigir acesso de administrador.

Ao criar uma versão `app-v*`, o workflow cria um GitHub Release rascunho contendo o instalador. Nenhum build precisa acontecer no computador de trabalho.

### Teste rápido

A aplicação web não exige instalação ou build. Sirva os arquivos por HTTPS ou por um servidor web e abra `index.html`.

O navegador exige contexto seguro para compartilhamento de tela. Depois que o PR for aprovado, o frontend poderá ser publicado gratuitamente pelo GitHub Pages.

## Limite atual

O compartilhamento desta entrega mostra uma prévia real da tela no próprio cliente. Para que amigos recebam a transmissão, a próxima etapa adicionará API, autenticação multiusuário e LiveKit self-hosted.

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para a arquitetura completa e a sequência de implementação.

## Estrutura

```text
index.html                 interface e marcação
styles.css                identidade visual responsiva
app.js                    perfil, mensagens e captura de tela
manifest.webmanifest      instalação como aplicativo
service-worker.js         shell offline
docs/ARCHITECTURE.md      arquitetura multiusuário
assets/icon.svg            identidade do aplicativo
package.json               comandos de empacotamento
scripts/prepare-dist.mjs   prepara o frontend para desktop
src-tauri/                 cliente e instalador Windows
.github/workflows/        validação e releases remotos
```

## Privacidade

Nenhuma senha, token ou segredo deve ser versionado. Nesta etapa, perfil e mensagens de demonstração ficam apenas no `localStorage` do navegador.
