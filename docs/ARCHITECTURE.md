# Arquitetura do Enantato

## Objetivo

O Enantato será uma plataforma privada para grupos de amigos, com contas individuais, servidores, canais de texto e voz, perfis animados, presença e compartilhamento de tela de alta qualidade.

A interface desta primeira entrega é deliberadamente independente de framework e build. Isso permite validar o produto no GitHub Pages antes de introduzir a infraestrutura de tempo real.

## Estado atual

A branch `feat/initial-platform` contém um protótipo navegável com:

- entrada e perfil persistidos no navegador;
- avatar e banner por URL, incluindo arquivos GIF;
- emoji e texto de status;
- servidores, canais e salas de voz representados na interface;
- mensagens locais separadas por canal;
- captura real de aba, janela ou monitor com `getDisplayMedia`;
- perfis de qualidade de 720p30 até 4K60;
- PWA com shell offline;
- interface responsiva e validação no GitHub Actions.

A captura desta etapa é uma prévia local. Ela ainda não envia mídia para outros usuários.

## Arquitetura multiusuário planejada

```text
Navegador / PWA
  ├── HTTPS + WebSocket ── API TypeScript
  │                         ├── PostgreSQL (usuários, servidores, canais, mensagens)
  │                         ├── Redis (presença, sessões e eventos transitórios)
  │                         └── armazenamento de mídia (avatars, banners e anexos)
  │
  └── WebRTC ───────────── LiveKit SFU
                            └── Coturn (fallback para redes restritas)
```

### Interface

- React e TypeScript quando a interface passar para componentes.
- PWA responsiva como cliente principal.
- Aplicativo desktop opcional empacotado posteriormente com Tauri.
- Estado otimista e cache local para mensagens recentes.

### API

- Node.js com TypeScript.
- Autenticação por sessão segura e senha com Argon2id.
- API HTTP para dados persistentes.
- WebSocket para mensagens, presença, digitação e alterações de sala.
- Emissão de tokens LiveKit de curta duração, nunca armazenados no cliente.

### Comunicação em tempo real

- LiveKit self-hosted como SFU WebRTC.
- Uma publicação de tela por transmissor, distribuída pelo SFU.
- Simulcast/SVC e seleção adaptativa de camadas.
- Opus para voz.
- AV1 ou VP9 para tela quando disponível, com H.264 como fallback.
- Coturn autenticado com credenciais temporárias para NATs restritivos.

### Dados

Entidades iniciais:

- `users`, `sessions`, `profiles`;
- `servers`, `server_members`, `roles`, `permissions`;
- `channels`, `voice_rooms`;
- `messages`, `attachments`, `reactions`;
- `presence` e `voice_states` como estado efêmero no Redis.

### Infraestrutura sem mensalidade

O repositório e a interface estática podem permanecer no GitHub. A API, PostgreSQL, Redis, LiveKit e Coturn serão executados por Docker Compose em uma máquina fora do computador de trabalho. Certificados HTTPS podem ser automatizados pelo Caddy.

A qualidade final depende do upload da máquina que hospeda o SFU. Os perfis de resolução representam limites desejados; WebRTC ajustará bitrate e resolução conforme rede, navegador e hardware.

## Etapas

1. Validar a experiência e a identidade visual desta branch.
2. Transformar a interface em aplicação TypeScript testável.
3. Implementar contas, banco e servidores/canais.
4. Integrar mensagens e presença via WebSocket.
5. Integrar LiveKit para voz, vídeo e tela.
6. Adicionar Coturn, permissões, moderação e uploads.
7. Medir qualidade, latência e uso de banda com o grupo.
