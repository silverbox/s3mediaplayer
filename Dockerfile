FROM ubuntu:24.04

WORKDIR /workspace

RUN apt-get update && apt-get install -y curl unzip nodejs npm

RUN npm install -g aws-cdk

RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

CMD ["cd frontend && npm install && cd ../cdk && npm install"]
