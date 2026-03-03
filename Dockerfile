FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev

COPY tsconfig.json ./
COPY jest.config.cjs ./

COPY src ./src
COPY tests ./tests
COPY migrations ./migrations

EXPOSE 3000

CMD ["npm", "run", "dev"]
