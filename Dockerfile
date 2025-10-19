# imagem oficial Node.js mais estável e rápida que alpine
FROM node:20-slim

# Define diretório de trabalho
WORKDIR /app

# Copia apenas os manifests primeiro (melhor cache)
COPY package*.json ./

# Instala só dependências de produção
RUN npm install --omit=dev

# Copia código da aplicação
COPY . .

# Expõe a porta
EXPOSE 8080

# Healthcheck básico
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(()=>process.exit(1))"

# Inicia o server
CMD ["node", "server.js"]
