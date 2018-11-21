FROM node:10-alpine AS build

WORKDIR /app
COPY . /app
RUN npm install --no-optional && npm run build

FROM node:10-alpine

WORKDIR /app
ENV RETISHA_HOME /var/lib/retisha
RUN apk add --no-cache ca-certificates \
                       ffmpeg \
                       openssl \
                       python3 \
 && pip3 install youtube-dl
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm install --only=prod --no-optional && npm cache clean --force
COPY --from=build /app/dist /app/dist

CMD ["npm", "start"]
