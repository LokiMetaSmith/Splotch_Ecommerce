# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package.json ./
COPY package-lock.json ./

# Install only production dependencies
# NPM installs need to be done as root or a user with write access.
# Running as root is default here.
RUN npm ci --only=production

# Copy the rest of the application source code
COPY . .

# Change ownership of the working directory to the non-root 'node' user
# The 'node' user is included by default in the official node image
RUN chown -R node:node /usr/src/app

# Switch to the non-root user
USER node

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run your app
CMD ["node", "index.js"]
