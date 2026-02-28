import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as logs from 'aws-cdk-lib/aws-logs';

// extend the stock props so we can pass a prefix through the stack
export interface CdkStackProps extends cdk.StackProps {
  stackName?: string; // allow stackName to be overridden (otherwise we compute one based on prefix)
  /** optional prefix applied to names of resources */
  prefix?: string;
  /** when true the example lambda and API are not created (useful for unit tests) */
  disableLambda?: boolean;
  lambdaVersionKey?: string; // optional version key to force lambda updates when code changes without changing the logical ID; can also be set via cdk context (e.g. -c lambdaVersionKey=v2)

  /** optional alternate domain for the CloudFront distribution */
  domainName?: string;
  /** if providing a domain name, you can optionally pass an ACM certificate ARN */
  certificateArn?: string;
  // optional API key value to be used in the example lambda's API Gateway; can also be set via cdk context (e.g. -
  apiKey?: string;
}

export class CdkStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CdkStackProps = {}) {
    // calculate provisional prefix (parameters haven't been created yet)
    const protoPrefix = props.prefix ?? scope.node.tryGetContext('prefix');
    const stackName = props.stackName ?? (protoPrefix ? `${protoPrefix}-stack` : undefined);

    super(scope, id, { ...props, stackName });
    const prefix = props.prefix ?? scope.node.tryGetContext('prefix');
    const lambdaVersionKey = props.lambdaVersionKey ?? scope.node.tryGetContext('lambdaVersionKey') ?? 'v1';
    const domainName = props.domainName ?? undefined;
    const certificateArn = props.certificateArn ?? undefined;

    // ------------------------------------------------------------------
    // CloudFormation parameters corresponding to props in CdkStackProps.
    // These allow the values to be specified at deploy time via CFN APIs
    // or the `cdk deploy -c` command.  must be created after calling super.
    // const prefixParam = new cdk.CfnParameter(this, 'Prefix', {
    //   type: 'String',
    //   default: props.prefix ?? '',
    //   description: 'Optional resource name prefix',
    // });

    // const disableLambdaParam = new cdk.CfnParameter(this, 'DisableLambda', {
    //   type: 'String',
    //   allowedValues: ['true', 'false'],
    //   default: String(props.disableLambda ?? false),
    //   description: 'Set to true to skip creation of example lambda/API',
    // });

    // const lambdaVersionKeyParam = new cdk.CfnParameter(this, 'LambdaVersionKey', {
    //   type: 'String',
    //   default: props.lambdaVersionKey ?? 'v1',
    //   description: 'Key used to force lambda redeploys when code changes',
    // });

    // const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
    //   type: 'String',
    //   default: props.domainName ?? '',
    //   description: 'Optional alternate domain for the CloudFront distribution',
    // });

    // const certificateArnParam = new cdk.CfnParameter(this, 'CertificateArn', {
    //   type: 'String',
    //   default: props.certificateArn ?? '',
    //   description: 'If providing domainName, optionally supply an ACM cert ARN',
    // });

    // optional example lambda + API; can be skipped during testing
    // parameter for the API key that CloudFront will attach to requests.
    const apiKeyParam = new cdk.CfnParameter(this, 'ApiKey', {
      type: 'String',
      default: props.apiKey ?? '',
      description: 'Value used as x-api-key header when CloudFront talks to API Gateway',
    });

    // derive runtime values: props take precedence, then parameters, then
    // defaults / context
    // const prefix = props.prefix ?? (prefixParam.valueAsString || scope.node.tryGetContext('prefix'));
    // const disableLambda = props.disableLambda ?? (disableLambdaParam.valueAsString === 'true');
    // const lambdaVersionKey = props.lambdaVersionKey ?? lambdaVersionKeyParam.valueAsString ?? 'v1';
    // const domainName = props.domainName ?? (domainNameParam.valueAsString || undefined);
    // const certificateArn = props.certificateArn ?? (certificateArnParam.valueAsString || undefined);
    const apiKeyVal = props.apiKey ?? apiKeyParam.valueAsString ?? 'test-api-key';

    // prefix and account id are now available for the rest of the stack
    const accountId = this.account;

    // helper to build names only when a prefix is supplied
    const withPrefix = (name: string) => `${prefix}-${name}`;
    const withAccountId = (name: string) => `${prefix}-${name}-${accountId}`;

    // S3 bucket to hold media files
    this.bucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: withAccountId('media-bucket'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // autoDeleteObjects: true,
    });

    // front-end asset bucket (served via CloudFront)
    const assetBucket = new s3.Bucket(this, 'AssetBucket', {
      bucketName: withAccountId('asset-bucket'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // blockPublicAccess: new s3.BlockPublicAccess({
      //   blockPublicAcls: true,
      //   blockPublicPolicy: false, // CloudFrontのOACポリシーを許可
      //   ignorePublicAcls: true,
      //   restrictPublicBuckets: false, // CloudFrontのOACアクセスを許可
      // }),
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // // we serve the bucket as a static website, so it must be publicly readable
    // assetBucket.addToResourcePolicy(new iam.PolicyStatement({
    //   actions: ['s3:GetObject'],
    //   resources: [assetBucket.arnForObjects('*')],
    //   principals: [new iam.AnyPrincipal()],
    // }));

    // Cognito user pool for authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: withPrefix('user-pool'),
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient('web-client', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: withPrefix('identity-pool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // IAM role for authenticated users to access their folder in the bucket
    const authenticatedRole = new iam.Role(this, 'CognitoDefaultAuthenticatedRole', {
      roleName: withPrefix('authenticated-role'),
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' },
      }, 'sts:AssumeRoleWithWebIdentity'),
    });

    // Policy to allow object operations only within the user's folder
    authenticatedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:List*', 's3:GetBucketLocation'],
      resources: [
        this.bucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}',
        this.bucket.bucketArn + '/${cognito-identity.amazonaws.com:sub}/*'
      ]
    }));

    // attach the role to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    let api: apigateway.RestApi | undefined;
    if (!props.disableLambda) {
      // create a layer containing aws-sdk (v2) so that it's available in the
      // Node runtime; newer NodeJS lambda runtimes no longer include the v2
      // SDK by default.
      const awsSdkLayer = new lambda.LayerVersion(this, 'AwsSdkLayer', {
        layerVersionName: withPrefix('lambda-layer'),
        code: lambda.Code.fromAsset('lambda/layers/aws-sdk-layer'),
        compatibleRuntimes: [
          lambda.Runtime.NODEJS_24_X
        ],
        description: 'Optional AWS SDK v2 layer for functions that rely on require("aws-sdk")',
      });

      const listLambda = new lambda.Function(this, 'ListHandler', {
        functionName: withPrefix('list-handler'),
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('lambda/list'),
        environment: {
          BUCKET: this.bucket.bucketName,
          IDENTITY_POOL_ID: identityPool.ref,
          USER_POOL_ID: this.userPool.userPoolId,
          VID: lambdaVersionKey
        },
        layers: [awsSdkLayer],
      });

      // Grant lambda read access to bucket
      this.bucket.grantRead(listLambda);

      // create a log group for the function with 30‑day retention
      new logs.LogGroup(this, 'ListHandlerLogGroup', {
        logGroupName: `/aws/lambda/${listLambda.functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // API Gateway fronting the lambda
      api = new apigateway.RestApi(this, 'MediaApi', {
        restApiName: withPrefix('media-api'),
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
        },
        apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
      });

      // create an API Gateway ApiKey resource that matches the parameter value
      const apiKey = new apigateway.ApiKey(this, 'GwApiKey', {
        apiKeyName: withPrefix('api-key'),
        value: apiKeyVal,
      });
      const usagePlan = api.addUsagePlan('UsagePlan', {
        name: withPrefix('usage-plan'),
      });
      usagePlan.addApiKey(apiKey);
      usagePlan.addApiStage({ stage: api.deploymentStage });

      // add a Cognito User Pools authorizer so that only authenticated
      // requests with a valid ID token are allowed; the token’s claims will
      // be passed through to the Lambda (used to extract sub/user id).
      const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [this.userPool],
      });

      const listIntegration = new apigateway.LambdaIntegration(listLambda);
      // expose the lambda under an /api path so that CloudFront behavior
      // which routes "/api/*" to this origin will match correctly.  It also
      // makes the API gateway URL look like https://.../prod/api
      const apiResource = api!.root.addResource('api');
      apiResource.addMethod('GET', listIntegration, {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
        apiKeyRequired: true,
      });

      // healthcheck endpoint without any authorizer; used by CloudFront to
      // verify that the API gateway is reachable. a simple mock integration
      // returns HTTP 200.
      const health = api.root.addResource('healthcheck');
      health.addMethod('GET', new apigateway.MockIntegration({
        integrationResponses: [{ statusCode: '200' }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: { 'application/json': '{"statusCode": 200}' },
      }), {
        methodResponses: [{ statusCode: '200' }],
        authorizationType: apigateway.AuthorizationType.NONE,
      });
    }

    // build CloudFront distribution that fronts the asset bucket and optionally the API
    // we avoid the non-null assertion by constructing the additional behaviors
    // only when `api` is defined. the origin object is created once and reused
    // for both the normal `/api/*` path and the healthcheck path so that the
    // resulting distribution shares a single origin rather than spinning up two
    // identical ones.
    let additionalBehaviors: Record<string, cloudfront.BehaviorOptions> | undefined;
    if (api) {
      const apiOrigin = new origins.RestApiOrigin(api, {
        customHeaders: {
          'x-api-key': apiKeyVal,
        },
      });
      const commonBehavior: Partial<cloudfront.BehaviorOptions> = {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      };
      additionalBehaviors = {
        'api/*': { origin: apiOrigin, ...commonBehavior },
        'healthcheck/*': { origin: apiOrigin, ...commonBehavior },
      };
    }

    const distributionProps: cloudfront.DistributionProps = {
      defaultBehavior: {
        // use the standard S3 origin rather than the static website origin
        origin: origins.S3BucketOrigin.withOriginAccessControl(assetBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },

      additionalBehaviors,
      domainNames: domainName ? [domainName] : undefined,
      certificate: certificateArn
        ? acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn)
        : undefined,
      defaultRootObject: 'index.html', // デフォルトルートオブジェクトを指定
    };

    const distribution = new cloudfront.Distribution(this, 'Distribution', distributionProps);

    // Outputs for front-end configuration
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
    // also output the asset bucket and distribution domain
    new cdk.CfnOutput(this, 'AssetBucketName', { value: assetBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.domainName });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
    // optional prefix export
    if (prefix) {
      new cdk.CfnOutput(this, 'ResourcePrefix', { value: prefix });
    }
  }
}
