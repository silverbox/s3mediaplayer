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
mkdir aws && cd aws
mkdir 01-persistent && cd 01-persistent && cdk init app --language typescript

スタック名はコンテキスト、それ以外をパラメーターで渡す
cd 01-persistent
cdk deploy -c prefix=foo-bar-mediaplayer
