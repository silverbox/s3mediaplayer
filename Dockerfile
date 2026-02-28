FROM ubuntu:24.04

WORKDIR /workspace

RUN apt-get update && apt-get install -y curl unzip nodejs npm

RUN npm install -g aws-cdk

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

CMD ["cd frontend && npm install && cd ../aws/01-persistent && npm install && cd ../aws/11-application && npm install && cd lambda/layers/aws-sdk-layer/nodejs && npm install && cd /workspace"]
