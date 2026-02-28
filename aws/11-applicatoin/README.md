# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

手動でcdk分割
mkdir 11-applicatoin && cd 11-applicatoin && cdk init app --language typescript

スタック名はコンテキスト、それ以外をパラメーターで渡す
cd 11-application
cd lambda/layers/aws-sdk-layer/nodejs && npm install && cd ../../../..

cdk deploy -c prefix=foo-bar-mediaplayer \
  --parameters MediaBucketName=foo-bar-mediaplayer-media-bucket-999999999999 \
  --parameters AssetBucketName=foo-bar-mediaplayer-asset-bucket-999999999999 \
  --parameters UserPoolId=ap-northeast-1_xxxxxxxx \
  --parameters IdentityPoolId=ap-northeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx \
  --parameters ApiKey=hogehogefugagufa \
  --parameters LambdaVersionKey=v20260228 \
  --parameters DomainName=s3playerv2.hogehoge.fugafuga.com \
  --parameters CertificateArn=arn:aws:acm:us-east-1:999999999999:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx

