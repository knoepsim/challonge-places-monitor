FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Persistente Daten im Ordner data/
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "start"]