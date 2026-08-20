# Servidor privado do Enantato

A arquitetura usa um servidor central para a turma. Somente esse computador precisa executar Docker; os amigos abrem o endereço HTTPS no navegador ou instalam o PWA.

## O que esta etapa entrega

- cadastro e login com senha derivada por scrypt;
- sessões privadas;
- mensagens persistentes por canal;
- presença online;
- atualização de perfil;
- WebSocket em tempo real;
- sinalização WebRTC;
- compartilhamento de tela P2P entre pessoas no mesmo canal;
- frontend, API e WebSocket no mesmo domínio HTTPS;
- dados guardados em volume Docker.

## Requisitos do computador servidor

- Docker com Docker Compose;
- portas TCP 80 e 443 liberadas;
- um domínio apontando para o IP público do servidor;
- encaminhamento das portas 80 e 443 no roteador quando o servidor estiver em uma rede doméstica.

## Configuração

1. No computador que ficará ligado, clone este repositório.
2. Copie .env.example para .env.
3. Troque APP_DOMAIN pelo domínio real.
4. Ajuste APP_ORIGIN para o mesmo domínio e, se o cliente do GitHub Pages for usado, mantenha também https://setedmsk.github.io.
5. Inicie os serviços:

    docker compose up -d --build

6. Verifique:

    docker compose ps
    curl https://SEU_DOMINIO/health

O Caddy solicita e renova o certificado TLS automaticamente. Os dados ficam no volume enantato-data.

## Como cada amigo entra

1. Abra https://SEU_DOMINIO.
2. Selecione **Criar conta** na primeira vez.
3. Informe o próprio usuário, senha, nome e emoji.
4. Depois, use **Entrar**.
5. Para instalar, use o botão **Instalar** do navegador.

Também é possível abrir o cliente do GitHub Pages e preencher **Servidor da turma** com https://SEU_DOMINIO.

## Backup

O estado persistente fica em /app/data/state.json dentro do volume enantato-data. Faça backup do volume antes de atualizar ou migrar o servidor.

## Rede de mídia

A configuração inicial usa STUN público e transmissão P2P, adequada para grupos pequenos. Redes com NAT restritivo podem exigir um servidor TURN. A próxima etapa adicionará Coturn e, para salas maiores, um SFU LiveKit.
