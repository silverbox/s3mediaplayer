# 概要

設定ファイルで指定したAWSアカウント、S3バケットを参照するウェブアプリです。

# 使用技術

## フロント側

- React
- Amplify UI(Cognito)

## サーバー(AWS)

- CloudFront
- API Gateway
- Lambda
- S3
- Cognito

## CI/CD

- cdk（TypeScript）によるIaCで、コマンドによるデプロイが可能
- ローカルPCで、devcontainerを使用してフロントサイドのみ起動しての開発が可能

## 開発環境のセットアップ

1. リポジトリをクローン／開く
2. **Devcontainer** を利用する場合は VS Code のコマンドパレットから "Remote-Containers: Reopen in Container" を実行します。
   - コンテナ内では `cd frontend && npm install` と `cd ../cdk && npm install` が自動的に実行されます。
3. 手動準備する場合:
   ```bash
   cd frontend
   npm install
   cd ../cdk
   npm install
   ```
4. フロントエンドの環境変数を `frontend/.env.local` に設定（`frontend/.env.example` をコピー）。

```bash
cp frontend/.env.example frontend/.env.local
# 先ほど CDK で出力された値に書き換える
```

CDK でスタックをデプロイすると、必要な設定値が出力されます。

- `ApiKey` パラメーター：CloudFront が API Gateway にリクエストを送信するときに
  `x-api-key` ヘッダーとして付与される値。API Gateway 側でも同じ値の
  ApiKey が作成され、呼び出し時にマッチする必要があります。
  
  **デプロイ時の指定方法**
  このパラメーターは CloudFormation のパラメーターなので、`cdk deploy`
  では `--parameters ApiKey=...` を使って渡します。`-c apiKey=...` で
  コンテキスト変数として指定しても、テンプレートに自動的には反映され
  ません（コード中でコンテキスト値をフォールバックとして使う仕組みは
  ありますが、正式にはパラメーターを使ってください）。


このほか、スタックデプロイ時にフロントエンドや本体の挙動を調整する
パラメーターを以下から指定できます。

| パラメーター名 | 説明 | デフォルト |
|---------------|------|------------|
| `Prefix` | リソース名に付与する接頭辞 | 空 |
| `DisableLambda` | Lambda/API を作成しない | false |
| `LambdaVersionKey` | Lambda の再デプロイをカンタンにするキー | v1 |
| `DomainName` | CloudFront のカスタムドメイン | 空 |
| `CertificateArn` | カスタムドメイン用 ACM 証明書 ARN | 空 |

# 構造

S3バケットの直下に、ユーザー毎のフォルダが作成されます。CognitoのFine-Grained Access Controlにより、ユーザー毎のフォルダのみアクセス可能です。

# 使い方

ページにアクセスするとCognitoへのログイン画面が表示されます。Cognitoユーザーは事前に登録しておく必要があります。サインアップ機能はありません。
ログイン後、ユーザー毎S3フォルダ配下の中身が表示されます。

## 機能

- ファイルのアップロード／ダウンロード
- 表示フォルダの移動
- フォルダ作成
- ファイルの一括選択
- 一括選択したメディアファイルの連続再生