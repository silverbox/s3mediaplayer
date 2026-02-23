# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template

## example

cd lambda/layers/aws-sdk-layer/nodejs && npm install && cd ../../../..
cdk bootstrap

aws login
cdk deploy -c prefix=foo-bar-mediaplayer -c lambdaVersionKey=v20260221a -c domainName=your.domain \
  -c certificateArn=arn:aws:acm:us-east-1:99999999999999:certificate/xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  -c apiKey=hogehoge-fugafuga

※apiKeyは初期ミス関係で、手動でCloudFrontに設定
