FROM node:20-alpine

# Install dependencies for native modules if needed
# Alpine doesn't have build tools by default, uncomment if npm install fails due to missing build-base
# RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm install

# Copy all files
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD [ "node", "index.js" ]