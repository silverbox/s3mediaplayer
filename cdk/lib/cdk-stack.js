"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const cognito = require("aws-cdk-lib/aws-cognito");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const logs = require("aws-cdk-lib/aws-logs");
class CdkStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        // calculate provisional prefix (parameters haven't been created yet)
        const protoPrefix = (_a = props.prefix) !== null && _a !== void 0 ? _a : scope.node.tryGetContext('prefix');
        const stackName = (_b = props.stackName) !== null && _b !== void 0 ? _b : (protoPrefix ? `${protoPrefix}-stack` : undefined);
        super(scope, id, { ...props, stackName });
        // ------------------------------------------------------------------
        // CloudFormation parameters corresponding to props in CdkStackProps.
        // These allow the values to be specified at deploy time via CFN APIs
        // or the `cdk deploy -c` command.  must be created after calling super.
        const prefixParam = new cdk.CfnParameter(this, 'Prefix', {
            type: 'String',
            default: (_c = props.prefix) !== null && _c !== void 0 ? _c : '',
            description: 'Optional resource name prefix',
        });
        const disableLambdaParam = new cdk.CfnParameter(this, 'DisableLambda', {
            type: 'String',
            allowedValues: ['true', 'false'],
            default: String((_d = props.disableLambda) !== null && _d !== void 0 ? _d : false),
            description: 'Set to true to skip creation of example lambda/API',
        });
        const lambdaVersionKeyParam = new cdk.CfnParameter(this, 'LambdaVersionKey', {
            type: 'String',
            default: (_e = props.lambdaVersionKey) !== null && _e !== void 0 ? _e : 'v1',
            description: 'Key used to force lambda redeploys when code changes',
        });
        const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
            type: 'String',
            default: (_f = props.domainName) !== null && _f !== void 0 ? _f : '',
            description: 'Optional alternate domain for the CloudFront distribution',
        });
        const certificateArnParam = new cdk.CfnParameter(this, 'CertificateArn', {
            type: 'String',
            default: (_g = props.certificateArn) !== null && _g !== void 0 ? _g : '',
            description: 'If providing domainName, optionally supply an ACM cert ARN',
        });
        // derive runtime values: props take precedence, then parameters, then
        // defaults / context
        const prefix = (_h = props.prefix) !== null && _h !== void 0 ? _h : (prefixParam.valueAsString || scope.node.tryGetContext('prefix'));
        const disableLambda = (_j = props.disableLambda) !== null && _j !== void 0 ? _j : (disableLambdaParam.valueAsString === 'true');
        const lambdaVersionKey = (_l = (_k = props.lambdaVersionKey) !== null && _k !== void 0 ? _k : lambdaVersionKeyParam.valueAsString) !== null && _l !== void 0 ? _l : 'v1';
        const domainName = (_m = props.domainName) !== null && _m !== void 0 ? _m : (domainNameParam.valueAsString || undefined);
        const certificateArn = (_o = props.certificateArn) !== null && _o !== void 0 ? _o : (certificateArnParam.valueAsString || undefined);
        // prefix and account id are now available for the rest of the stack
        const accountId = this.account;
        // helper to build names only when a prefix is supplied
        const withPrefix = (name) => `${prefix}-${name}`;
        const withAccountId = (name) => `${prefix}-${name}-${accountId}`;
        // S3 bucket to hold media files
        this.bucket = new s3.Bucket(this, 'MediaBucket', {
            bucketName: withAccountId('media-bucket'),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        // front-end asset bucket (served via CloudFront)
        const assetBucket = new s3.Bucket(this, 'AssetBucket', {
            bucketName: withAccountId('asset-bucket'),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
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
            removalPolicy: cdk.RemovalPolicy.DESTROY,
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
        // optional example lambda + API; can be skipped during testing
        // parameter for the API key that CloudFront will attach to requests.
        const apiKeyParam = new cdk.CfnParameter(this, 'ApiKey', {
            type: 'String',
            description: 'Value used as x-api-key header when CloudFront talks to API Gateway',
        });
        let api;
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
                value: apiKeyParam.valueAsString,
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
            const apiResource = api.root.addResource('api');
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
        let additionalBehaviors;
        if (api) {
            // RestApiOrigin doesn't allow custom headers, so build an HttpOrigin
            // manually and forward the apiKey parameter as x-api-key.
            // const apiUrl = api.url;
            // const stripped = apiUrl.replace(/^https?:\/\//, '').split('/');
            // const apiDomain = stripped[0];
            // const apiPath = '/' + stripped.slice(1).join('/');
            // const apiOrigin = new origins.HttpOrigin(apiDomain, {
            //   originPath: apiPath,
            //   customHeaders: {
            //     'x-api-key': apiKeyParam.valueAsString,
            //   },
            // });
            const apiOrigin = new origins.RestApiOrigin(api, {
                customHeaders: {
                    'x-api-key': apiKeyParam.valueAsString,
                },
            });
            const commonBehavior = {
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
        const distributionProps = {
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
exports.CdkStack = CdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyx5Q0FBeUM7QUFDekMsbURBQW1EO0FBQ25ELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFDakQseURBQXlEO0FBQ3pELHlEQUF5RDtBQUN6RCw4REFBOEQ7QUFDOUQsMERBQTBEO0FBQzFELDZDQUE2QztBQWlCN0MsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLckMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxRQUF1QixFQUFFOztRQUNqRSxxRUFBcUU7UUFDckUsTUFBTSxXQUFXLEdBQUcsTUFBQSxLQUFLLENBQUMsTUFBTSxtQ0FBSSxLQUFLLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUN2RSxNQUFNLFNBQVMsR0FBRyxNQUFBLEtBQUssQ0FBQyxTQUFTLG1DQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxHQUFHLFdBQVcsUUFBUSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUV4RixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsS0FBSyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFFMUMscUVBQXFFO1FBQ3JFLHFFQUFxRTtRQUNyRSxxRUFBcUU7UUFDckUsd0VBQXdFO1FBQ3hFLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ3ZELElBQUksRUFBRSxRQUFRO1lBQ2QsT0FBTyxFQUFFLE1BQUEsS0FBSyxDQUFDLE1BQU0sbUNBQUksRUFBRTtZQUMzQixXQUFXLEVBQUUsK0JBQStCO1NBQzdDLENBQUMsQ0FBQztRQUVILE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxlQUFlLEVB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QVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUUsRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDbEYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxFQUFFLEtBQUssRUFBRSxZQUFZLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUN2RSx5QkFBeUI7UUFDekIsSUFBSSxNQUFNLEVBQUUsQ0FBQztZQUNYLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUMvRCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBdlRELDRCQXVUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5cbi8vIGV4dGVuZCB0aGUgc3RvY2sgcHJvcHMgc28gd2UgY2FuIHBhc3MgYSBwcmVmaXggdGhyb3VnaCB0aGUgc3RhY2tcbmV4cG9ydCBpbnRlcmZhY2UgQ2RrU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgc3RhY2tOYW1lPzogc3RyaW5nOyAvLyBhbGxvdyBzdGFja05hbWUgdG8gYmUgb3ZlcnJpZGRlbiAob3RoZXJ3aXNlIHdlIGNvbXB1dGUgb25lIGJhc2VkIG9uIHByZWZpeClcbiAgLyoqIG9wdGlvbmFsIHByZWZpeCBhcHBsaWVkIHRvIG5hbWVzIG9mIHJlc291cmNlcyAqL1xuICBwcmVmaXg/OiBzdHJpbmc7XG4gIC8qKiB3aGVuIHRydWUgdGhlIGV4YW1wbGUgbGFtYmRhIGFuZCBBUEkgYXJlIG5vdCBjcmVhdGVkICh1c2VmdWwgZm9yIHVuaXQgdGVzdHMpICovXG4gIGRpc2FibGVMYW1iZGE/OiBib29sZWFuO1xuICBsYW1iZGFWZXJzaW9uS2V5Pzogc3RyaW5nOyAvLyBvcHRpb25hbCB2ZXJzaW9uIGtleSB0byBmb3JjZSBsYW1iZGEgdXBkYXRlcyB3aGVuIGNvZGUgY2hhbmdlcyB3aXRob3V0IGNoYW5naW5nIHRoZSBsb2dpY2FsIElEOyBjYW4gYWxzbyBiZSBzZXQgdmlhIGNkayBjb250ZXh0IChlLmcuIC1jIGxhbWJkYVZlcnNpb25LZXk9djIpXG5cbiAgLyoqIG9wdGlvbmFsIGFsdGVybmF0ZSBkb21haW4gZm9yIHRoZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiAqL1xuICBkb21haW5OYW1lPzogc3RyaW5nO1xuICAvKiogaWYgcHJvdmlkaW5nIGEgZG9tYWluIG5hbWUsIHlvdSBjYW4gb3B0aW9uYWxseSBwYXNzIGFuIEFDTSBjZXJ0aWZpY2F0ZSBBUk4gKi9cbiAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDZGtTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbDogY29nbml0by5Vc2VyUG9vbDtcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sQ2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50O1xuICBwdWJsaWMgcmVhZG9ubHkgYnVja2V0OiBzMy5CdWNrZXQ7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENka1N0YWNrUHJvcHMgPSB7fSkge1xuICAgIC8vIGNhbGN1bGF0ZSBwcm92aXNpb25hbCBwcmVmaXggKHBhcmFtZXRlcnMgaGF2ZW4ndCBiZWVuIGNyZWF0ZWQgeWV0KVxuICAgIGNvbnN0IHByb3RvUHJlZml4ID0gcHJvcHMucHJlZml4ID8/IHNjb3BlLm5vZGUudHJ5R2V0Q29udGV4dCgncHJlZml4Jyk7XG4gICAgY29uc3Qgc3RhY2tOYW1lID0gcHJvcHMuc3RhY2tOYW1lID8/IChwcm90b1ByZWZpeCA/IGAke3Byb3RvUHJlZml4fS1zdGFja2AgOiB1bmRlZmluZWQpO1xuXG4gICAgc3VwZXIoc2NvcGUsIGlkLCB7IC4uLnByb3BzLCBzdGFja05hbWUgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBDbG91ZEZvcm1hdGlvbiBwYXJhbWV0ZXJzIGNvcnJlc3BvbmRpbmcgdG8gcHJvcHMgaW4gQ2RrU3RhY2tQcm9wcy5cbiAgICAvLyBUaGVzZSBhbGxvdyB0aGUgdmFsdWVzIHRvIGJlIHNwZWNpZmllZCBhdCBkZXBsb3kgdGltZSB2aWEgQ0ZOIEFQSXNcbiAgICAvLyBvciB0aGUgYGNkayBkZXBsb3kgLWNgIGNvbW1hbmQuICBtdXN0IGJlIGNyZWF0ZWQgYWZ0ZXIgY2FsbGluZyBzdXBlci5cbiAgICBjb25zdCBwcmVmaXhQYXJhbSA9IG5ldyBjZGsuQ2ZuUGFyYW1ldGVyKHRoaXMsICdQcmVmaXgnLCB7XG4gICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgIGRlZmF1bHQ6IHByb3BzLnByZWZpeCA/PyAnJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT3B0aW9uYWwgcmVzb3VyY2UgbmFtZSBwcmVmaXgnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGlzYWJsZUxhbWJkYVBhcmFtID0gbmV3IGNkay5DZm5QYXJhbWV0ZXIodGhpcywgJ0Rpc2FibGVMYW1iZGEnLCB7XG4gICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgIGFsbG93ZWRWYWx1ZXM6IFsndHJ1ZScsICdmYWxzZSddLFxuICAgICAgZGVmYXVsdDogU3RyaW5nKHByb3BzLmRpc2FibGVMYW1iZGEgPz8gZmFsc2UpLFxuICAgICAgZGVzY3JpcHRpb246ICdTZXQgdG8gdHJ1ZSB0byBza2lwIGNyZWF0aW9uIG9mIGV4YW1wbGUgbGFtYmRhL0FQSScsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsYW1iZGFWZXJzaW9uS2V5UGFyYW0gPSBuZXcgY2RrLkNmblBhcmFtZXRlcih0aGlzLCAnTGFtYmRhVmVyc2lvbktleScsIHtcbiAgICAgIHR5cGU6ICdTdHJpbmcnLFxuICAgICAgZGVmYXVsdDogcHJvcHMubGFtYmRhVmVyc2lvbktleSA/PyAndjEnLFxuICAgICAgZGVzY3JpcHRpb246ICdLZXkgdXNlZCB0byBmb3JjZSBsYW1iZGEgcmVkZXBsb3lzIHdoZW4gY29kZSBjaGFuZ2VzJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRvbWFpbk5hbWVQYXJhbSA9IG5ldyBjZGsuQ2ZuUGFyYW1ldGVyKHRoaXMsICdEb21haW5OYW1lJywge1xuICAgICAgdHlwZTogJ1N0cmluZycsXG4gICAgICBkZWZhdWx0OiBwcm9wcy5kb21haW5OYW1lID8/ICcnLFxuICAgICAgZGVzY3JpcHRpb246ICdPcHRpb25hbCBhbHRlcm5hdGUgZG9tYWluIGZvciB0aGUgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2VydGlmaWNhdGVBcm5QYXJhbSA9IG5ldyBjZGsuQ2ZuUGFyYW1ldGVyKHRoaXMsICdDZXJ0aWZpY2F0ZUFybicsIHtcbiAgICAgIHR5cGU6ICdTdHJpbmcnLFxuICAgICAgZGVmYXVsdDogcHJvcHMuY2VydGlmaWNhdGVBcm4gPz8gJycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0lmIHByb3ZpZGluZyBkb21haW5OYW1lLCBvcHRpb25hbGx5IHN1cHBseSBhbiBBQ00gY2VydCBBUk4nLFxuICAgIH0pO1xuXG4gICAgLy8gZGVyaXZlIHJ1bnRpbWUgdmFsdWVzOiBwcm9wcyB0YWtlIHByZWNlZGVuY2UsIHRoZW4gcGFyYW1ldGVycywgdGhlblxuICAgIC8vIGRlZmF1bHRzIC8gY29udGV4dFxuICAgIGNvbnN0IHByZWZpeCA9IHByb3BzLnByZWZpeCA/PyAocHJlZml4UGFyYW0udmFsdWVBc1N0cmluZyB8fCBzY29wZS5ub2RlLnRyeUdldENvbnRleHQoJ3ByZWZpeCcpKTtcbiAgICBjb25zdCBkaXNhYmxlTGFtYmRhID0gcHJvcHMuZGlzYWJsZUxhbWJkYSA/PyAoZGlzYWJsZUxhbWJkYVBhcmFtLnZhbHVlQXNTdHJpbmcgPT09ICd0cnVlJyk7XG4gICAgY29uc3QgbGFtYmRhVmVyc2lvbktleSA9IHByb3BzLmxhbWJkYVZlcnNpb25LZXkgPz8gbGFtYmRhVmVyc2lvbktleVBhcmFtLnZhbHVlQXNTdHJpbmcgPz8gJ3YxJztcbiAgICBjb25zdCBkb21haW5OYW1lID0gcHJvcHMuZG9tYWluTmFtZSA/PyAoZG9tYWluTmFtZVBhcmFtLnZhbHVlQXNTdHJpbmcgfHwgdW5kZWZpbmVkKTtcbiAgICBjb25zdCBjZXJ0aWZpY2F0ZUFybiA9IHByb3BzLmNlcnRpZmljYXRlQXJuID8/IChjZXJ0aWZpY2F0ZUFyblBhcmFtLnZhbHVlQXNTdHJpbmcgfHwgdW5kZWZpbmVkKTtcblxuICAgIC8vIHByZWZpeCBhbmQgYWNjb3VudCBpZCBhcmUgbm93IGF2YWlsYWJsZSBmb3IgdGhlIHJlc3Qgb2YgdGhlIHN0YWNrXG4gICAgY29uc3QgYWNjb3VudElkID0gdGhpcy5hY2NvdW50O1xuXG4gICAgLy8gaGVscGVyIHRvIGJ1aWxkIG5hbWVzIG9ubHkgd2hlbiBhIHByZWZpeCBpcyBzdXBwbGllZFxuICAgIGNvbnN0IHdpdGhQcmVmaXggPSAobmFtZTogc3RyaW5nKSA9PiBgJHtwcmVmaXh9LSR7bmFtZX1gO1xuICAgIGNvbnN0IHdpdGhBY2NvdW50SWQgPSAobmFtZTogc3RyaW5nKSA9PiBgJHtwcmVmaXh9LSR7bmFtZX0tJHthY2NvdW50SWR9YDtcblxuICAgIC8vIFMzIGJ1Y2tldCB0byBob2xkIG1lZGlhIGZpbGVzXG4gICAgdGhpcy5idWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdNZWRpYUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IHdpdGhBY2NvdW50SWQoJ21lZGlhLWJ1Y2tldCcpLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gZnJvbnQtZW5kIGFzc2V0IGJ1Y2tldCAoc2VydmVkIHZpYSBDbG91ZEZyb250KVxuICAgIGNvbnN0IGFzc2V0QnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXNzZXRCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiB3aXRoQWNjb3VudElkKCdhc3NldC1idWNrZXQnKSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICAvLyBibG9ja1B1YmxpY0FjY2VzczogbmV3IHMzLkJsb2NrUHVibGljQWNjZXNzKHtcbiAgICAgIC8vICAgYmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgLy8gICBibG9ja1B1YmxpY1BvbGljeTogZmFsc2UsIC8vIENsb3VkRnJvbnTjga5PQUPjg53jg6rjgrfjg7zjgpLoqLHlj69cbiAgICAgIC8vICAgaWdub3JlUHVibGljQWNsczogdHJ1ZSxcbiAgICAgIC8vICAgcmVzdHJpY3RQdWJsaWNCdWNrZXRzOiBmYWxzZSwgLy8gQ2xvdWRGcm9udOOBrk9BQ+OCouOCr+OCu+OCueOCkuioseWPr1xuICAgICAgLy8gfSksXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgfSk7XG5cbiAgICAvLyAvLyB3ZSBzZXJ2ZSB0aGUgYnVja2V0IGFzIGEgc3RhdGljIHdlYnNpdGUsIHNvIGl0IG11c3QgYmUgcHVibGljbHkgcmVhZGFibGVcbiAgICAvLyBhc3NldEJ1Y2tldC5hZGRUb1Jlc291cmNlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAvLyAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0J10sXG4gICAgLy8gICByZXNvdXJjZXM6IFthc3NldEJ1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgIC8vICAgcHJpbmNpcGFsczogW25ldyBpYW0uQW55UHJpbmNpcGFsKCldLFxuICAgIC8vIH0pKTtcblxuICAgIC8vIENvZ25pdG8gdXNlciBwb29sIGZvciBhdXRoZW50aWNhdGlvblxuICAgIHRoaXMudXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnVXNlclBvb2wnLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IHdpdGhQcmVmaXgoJ3VzZXItcG9vbCcpLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IGZhbHNlLFxuICAgICAgc2lnbkluQWxpYXNlczogeyB1c2VybmFtZTogdHJ1ZSwgZW1haWw6IHRydWUgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50ID0gdGhpcy51c2VyUG9vbC5hZGRDbGllbnQoJ3dlYi1jbGllbnQnLCB7XG4gICAgICBhdXRoRmxvd3M6IHtcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sKHRoaXMsICdJZGVudGl0eVBvb2wnLCB7XG4gICAgICBpZGVudGl0eVBvb2xOYW1lOiB3aXRoUHJlZml4KCdpZGVudGl0eS1wb29sJyksXG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjbGllbnRJZDogdGhpcy51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgIHByb3ZpZGVyTmFtZTogdGhpcy51c2VyUG9vbC51c2VyUG9vbFByb3ZpZGVyTmFtZSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBJQU0gcm9sZSBmb3IgYXV0aGVudGljYXRlZCB1c2VycyB0byBhY2Nlc3MgdGhlaXIgZm9sZGVyIGluIHRoZSBidWNrZXRcbiAgICBjb25zdCBhdXRoZW50aWNhdGVkUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ29nbml0b0RlZmF1bHRBdXRoZW50aWNhdGVkUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiB3aXRoUHJlZml4KCdhdXRoZW50aWNhdGVkLXJvbGUnKSxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5GZWRlcmF0ZWRQcmluY2lwYWwoJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsIHtcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7ICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZiB9LFxuICAgICAgICAnRm9yQW55VmFsdWU6U3RyaW5nTGlrZSc6IHsgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAnYXV0aGVudGljYXRlZCcgfSxcbiAgICAgIH0sICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eScpLFxuICAgIH0pO1xuXG4gICAgLy8gUG9saWN5IHRvIGFsbG93IG9iamVjdCBvcGVyYXRpb25zIG9ubHkgd2l0aGluIHRoZSB1c2VyJ3MgZm9sZGVyXG4gICAgYXV0aGVudGljYXRlZFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkRlbGV0ZU9iamVjdCcsICdzMzpMaXN0KicsICdzMzpHZXRCdWNrZXRMb2NhdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHRoaXMuYnVja2V0LmJ1Y2tldEFybiArICcvJHtjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206c3VifScsXG4gICAgICAgIHRoaXMuYnVja2V0LmJ1Y2tldEFybiArICcvJHtjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206c3VifS8qJ1xuICAgICAgXVxuICAgIH0pKTtcblxuICAgIC8vIGF0dGFjaCB0aGUgcm9sZSB0byB0aGUgaWRlbnRpdHkgcG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlcycsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgcm9sZXM6IHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBvcHRpb25hbCBleGFtcGxlIGxhbWJkYSArIEFQSTsgY2FuIGJlIHNraXBwZWQgZHVyaW5nIHRlc3RpbmdcbiAgICAvLyBwYXJhbWV0ZXIgZm9yIHRoZSBBUEkga2V5IHRoYXQgQ2xvdWRGcm9udCB3aWxsIGF0dGFjaCB0byByZXF1ZXN0cy5cbiAgICBjb25zdCBhcGlLZXlQYXJhbSA9IG5ldyBjZGsuQ2ZuUGFyYW1ldGVyKHRoaXMsICdBcGlLZXknLCB7XG4gICAgICB0eXBlOiAnU3RyaW5nJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVmFsdWUgdXNlZCBhcyB4LWFwaS1rZXkgaGVhZGVyIHdoZW4gQ2xvdWRGcm9udCB0YWxrcyB0byBBUEkgR2F0ZXdheScsXG4gICAgfSk7XG5cbiAgICBsZXQgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGkgfCB1bmRlZmluZWQ7XG4gICAgaWYgKCFwcm9wcy5kaXNhYmxlTGFtYmRhKSB7XG4gICAgICAvLyBjcmVhdGUgYSBsYXllciBjb250YWluaW5nIGF3cy1zZGsgKHYyKSBzbyB0aGF0IGl0J3MgYXZhaWxhYmxlIGluIHRoZVxuICAgICAgLy8gTm9kZSBydW50aW1lOyBuZXdlciBOb2RlSlMgbGFtYmRhIHJ1bnRpbWVzIG5vIGxvbmdlciBpbmNsdWRlIHRoZSB2MlxuICAgICAgLy8gU0RLIGJ5IGRlZmF1bHQuXG4gICAgICBjb25zdCBhd3NTZGtMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdBd3NTZGtMYXllcicsIHtcbiAgICAgICAgbGF5ZXJWZXJzaW9uTmFtZTogd2l0aFByZWZpeCgnbGFtYmRhLWxheWVyJyksXG4gICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhL2xheWVycy9hd3Mtc2RrLWxheWVyJyksXG4gICAgICAgIGNvbXBhdGlibGVSdW50aW1lczogW1xuICAgICAgICAgIGxhbWJkYS5SdW50aW1lLk5PREVKU18yNF9YXG4gICAgICAgIF0sXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnT3B0aW9uYWwgQVdTIFNESyB2MiBsYXllciBmb3IgZnVuY3Rpb25zIHRoYXQgcmVseSBvbiByZXF1aXJlKFwiYXdzLXNka1wiKScsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgbGlzdExhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0xpc3RIYW5kbGVyJywge1xuICAgICAgICBmdW5jdGlvbk5hbWU6IHdpdGhQcmVmaXgoJ2xpc3QtaGFuZGxlcicpLFxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjRfWCxcbiAgICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS9saXN0JyksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgQlVDS0VUOiB0aGlzLmJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgIElERU5USVRZX1BPT0xfSUQ6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICAgICAgVVNFUl9QT09MX0lEOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgVklEOiBsYW1iZGFWZXJzaW9uS2V5XG4gICAgICAgIH0sXG4gICAgICAgIGxheWVyczogW2F3c1Nka0xheWVyXSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBHcmFudCBsYW1iZGEgcmVhZCBhY2Nlc3MgdG8gYnVja2V0XG4gICAgICB0aGlzLmJ1Y2tldC5ncmFudFJlYWQobGlzdExhbWJkYSk7XG5cbiAgICAgIC8vIGNyZWF0ZSBhIGxvZyBncm91cCBmb3IgdGhlIGZ1bmN0aW9uIHdpdGggMzDigJFkYXkgcmV0ZW50aW9uXG4gICAgICBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTGlzdEhhbmRsZXJMb2dHcm91cCcsIHtcbiAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9sYW1iZGEvJHtsaXN0TGFtYmRhLmZ1bmN0aW9uTmFtZX1gLFxuICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9KTtcblxuICAgICAgLy8gQVBJIEdhdGV3YXkgZnJvbnRpbmcgdGhlIGxhbWJkYVxuICAgICAgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnTWVkaWFBcGknLCB7XG4gICAgICAgIHJlc3RBcGlOYW1lOiB3aXRoUHJlZml4KCdtZWRpYS1hcGknKSxcbiAgICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUtleVNvdXJjZVR5cGU6IGFwaWdhdGV3YXkuQXBpS2V5U291cmNlVHlwZS5IRUFERVIsXG4gICAgICB9KTtcblxuICAgICAgLy8gY3JlYXRlIGFuIEFQSSBHYXRld2F5IEFwaUtleSByZXNvdXJjZSB0aGF0IG1hdGNoZXMgdGhlIHBhcmFtZXRlciB2YWx1ZVxuICAgICAgY29uc3QgYXBpS2V5ID0gbmV3IGFwaWdhdGV3YXkuQXBpS2V5KHRoaXMsICdHd0FwaUtleScsIHtcbiAgICAgICAgYXBpS2V5TmFtZTogd2l0aFByZWZpeCgnYXBpLWtleScpLFxuICAgICAgICB2YWx1ZTogYXBpS2V5UGFyYW0udmFsdWVBc1N0cmluZyxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgdXNhZ2VQbGFuID0gYXBpLmFkZFVzYWdlUGxhbignVXNhZ2VQbGFuJywge1xuICAgICAgICBuYW1lOiB3aXRoUHJlZml4KCd1c2FnZS1wbGFuJyksXG4gICAgICB9KTtcbiAgICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoYXBpS2V5KTtcbiAgICAgIHVzYWdlUGxhbi5hZGRBcGlTdGFnZSh7IHN0YWdlOiBhcGkuZGVwbG95bWVudFN0YWdlIH0pO1xuXG4gICAgICAvLyBhZGQgYSBDb2duaXRvIFVzZXIgUG9vbHMgYXV0aG9yaXplciBzbyB0aGF0IG9ubHkgYXV0aGVudGljYXRlZFxuICAgICAgLy8gcmVxdWVzdHMgd2l0aCBhIHZhbGlkIElEIHRva2VuIGFyZSBhbGxvd2VkOyB0aGUgdG9rZW7igJlzIGNsYWltcyB3aWxsXG4gICAgICAvLyBiZSBwYXNzZWQgdGhyb3VnaCB0byB0aGUgTGFtYmRhICh1c2VkIHRvIGV4dHJhY3Qgc3ViL3VzZXIgaWQpLlxuICAgICAgY29uc3QgYXV0aG9yaXplciA9IG5ldyBhcGlnYXRld2F5LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsICdDb2duaXRvQXV0aG9yaXplcicsIHtcbiAgICAgICAgY29nbml0b1VzZXJQb29sczogW3RoaXMudXNlclBvb2xdLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGxpc3RJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxpc3RMYW1iZGEpO1xuICAgICAgLy8gZXhwb3NlIHRoZSBsYW1iZGEgdW5kZXIgYW4gL2FwaSBwYXRoIHNvIHRoYXQgQ2xvdWRGcm9udCBiZWhhdmlvclxuICAgICAgLy8gd2hpY2ggcm91dGVzIFwiL2FwaS8qXCIgdG8gdGhpcyBvcmlnaW4gd2lsbCBtYXRjaCBjb3JyZWN0bHkuICBJdCBhbHNvXG4gICAgICAvLyBtYWtlcyB0aGUgQVBJIGdhdGV3YXkgVVJMIGxvb2sgbGlrZSBodHRwczovLy4uLi9wcm9kL2FwaVxuICAgICAgY29uc3QgYXBpUmVzb3VyY2UgPSBhcGkhLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpO1xuICAgICAgYXBpUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBsaXN0SW50ZWdyYXRpb24sIHtcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgLy8gaGVhbHRoY2hlY2sgZW5kcG9pbnQgd2l0aG91dCBhbnkgYXV0aG9yaXplcjsgdXNlZCBieSBDbG91ZEZyb250IHRvXG4gICAgICAvLyB2ZXJpZnkgdGhhdCB0aGUgQVBJIGdhdGV3YXkgaXMgcmVhY2hhYmxlLiBhIHNpbXBsZSBtb2NrIGludGVncmF0aW9uXG4gICAgICAvLyByZXR1cm5zIEhUVFAgMjAwLlxuICAgICAgY29uc3QgaGVhbHRoID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2hlYWx0aGNoZWNrJyk7XG4gICAgICBoZWFsdGguYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5Nb2NrSW50ZWdyYXRpb24oe1xuICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW3sgc3RhdHVzQ29kZTogJzIwMCcgfV0sXG4gICAgICAgIHBhc3N0aHJvdWdoQmVoYXZpb3I6IGFwaWdhdGV3YXkuUGFzc3Rocm91Z2hCZWhhdmlvci5ORVZFUixcbiAgICAgICAgcmVxdWVzdFRlbXBsYXRlczogeyAnYXBwbGljYXRpb24vanNvbic6ICd7XCJzdGF0dXNDb2RlXCI6IDIwMH0nIH0sXG4gICAgICB9KSwge1xuICAgICAgICBtZXRob2RSZXNwb25zZXM6IFt7IHN0YXR1c0NvZGU6ICcyMDAnIH1dLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5OT05FLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gYnVpbGQgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdGhhdCBmcm9udHMgdGhlIGFzc2V0IGJ1Y2tldCBhbmQgb3B0aW9uYWxseSB0aGUgQVBJXG4gICAgLy8gd2UgYXZvaWQgdGhlIG5vbi1udWxsIGFzc2VydGlvbiBieSBjb25zdHJ1Y3RpbmcgdGhlIGFkZGl0aW9uYWwgYmVoYXZpb3JzXG4gICAgLy8gb25seSB3aGVuIGBhcGlgIGlzIGRlZmluZWQuIHRoZSBvcmlnaW4gb2JqZWN0IGlzIGNyZWF0ZWQgb25jZSBhbmQgcmV1c2VkXG4gICAgLy8gZm9yIGJvdGggdGhlIG5vcm1hbCBgL2FwaS8qYCBwYXRoIGFuZCB0aGUgaGVhbHRoY2hlY2sgcGF0aCBzbyB0aGF0IHRoZVxuICAgIC8vIHJlc3VsdGluZyBkaXN0cmlidXRpb24gc2hhcmVzIGEgc2luZ2xlIG9yaWdpbiByYXRoZXIgdGhhbiBzcGlubmluZyB1cCB0d29cbiAgICAvLyBpZGVudGljYWwgb25lcy5cbiAgICBsZXQgYWRkaXRpb25hbEJlaGF2aW9yczogUmVjb3JkPHN0cmluZywgY2xvdWRmcm9udC5CZWhhdmlvck9wdGlvbnM+IHwgdW5kZWZpbmVkO1xuICAgIGlmIChhcGkpIHtcbiAgICAgIC8vIFJlc3RBcGlPcmlnaW4gZG9lc24ndCBhbGxvdyBjdXN0b20gaGVhZGVycywgc28gYnVpbGQgYW4gSHR0cE9yaWdpblxuICAgICAgLy8gbWFudWFsbHkgYW5kIGZvcndhcmQgdGhlIGFwaUtleSBwYXJhbWV0ZXIgYXMgeC1hcGkta2V5LlxuICAgICAgLy8gY29uc3QgYXBpVXJsID0gYXBpLnVybDtcbiAgICAgIC8vIGNvbnN0IHN0cmlwcGVkID0gYXBpVXJsLnJlcGxhY2UoL15odHRwcz86XFwvXFwvLywgJycpLnNwbGl0KCcvJyk7XG4gICAgICAvLyBjb25zdCBhcGlEb21haW4gPSBzdHJpcHBlZFswXTtcbiAgICAgIC8vIGNvbnN0IGFwaVBhdGggPSAnLycgKyBzdHJpcHBlZC5zbGljZSgxKS5qb2luKCcvJyk7XG4gICAgICAvLyBjb25zdCBhcGlPcmlnaW4gPSBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGFwaURvbWFpbiwge1xuICAgICAgLy8gICBvcmlnaW5QYXRoOiBhcGlQYXRoLFxuICAgICAgLy8gICBjdXN0b21IZWFkZXJzOiB7XG4gICAgICAvLyAgICAgJ3gtYXBpLWtleSc6IGFwaUtleVBhcmFtLnZhbHVlQXNTdHJpbmcsXG4gICAgICAvLyAgIH0sXG4gICAgICAvLyB9KTtcbiAgICAgIGNvbnN0IGFwaU9yaWdpbiA9IG5ldyBvcmlnaW5zLlJlc3RBcGlPcmlnaW4oYXBpLCB7XG4gICAgICAgIGN1c3RvbUhlYWRlcnM6IHtcbiAgICAgICAgICAneC1hcGkta2V5JzogYXBpS2V5UGFyYW0udmFsdWVBc1N0cmluZyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgY29tbW9uQmVoYXZpb3I6IFBhcnRpYWw8Y2xvdWRmcm9udC5CZWhhdmlvck9wdGlvbnM+ID0ge1xuICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQUxMX1ZJRVdFUl9FWENFUFRfSE9TVF9IRUFERVIsXG4gICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeTogY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3kuQ09SU19BTExPV19BTExfT1JJR0lOUyxcbiAgICAgIH07XG4gICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzID0ge1xuICAgICAgICAnYXBpLyonOiB7IG9yaWdpbjogYXBpT3JpZ2luLCAuLi5jb21tb25CZWhhdmlvciB9LFxuICAgICAgICAnaGVhbHRoY2hlY2svKic6IHsgb3JpZ2luOiBhcGlPcmlnaW4sIC4uLmNvbW1vbkJlaGF2aW9yIH0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvblByb3BzOiBjbG91ZGZyb250LkRpc3RyaWJ1dGlvblByb3BzID0ge1xuICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgIC8vIHVzZSB0aGUgc3RhbmRhcmQgUzMgb3JpZ2luIHJhdGhlciB0aGFuIHRoZSBzdGF0aWMgd2Vic2l0ZSBvcmlnaW5cbiAgICAgICAgb3JpZ2luOiBvcmlnaW5zLlMzQnVja2V0T3JpZ2luLndpdGhPcmlnaW5BY2Nlc3NDb250cm9sKGFzc2V0QnVja2V0KSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICB9LFxuXG4gICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzLFxuICAgICAgZG9tYWluTmFtZXM6IGRvbWFpbk5hbWUgPyBbZG9tYWluTmFtZV0gOiB1bmRlZmluZWQsXG4gICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGVBcm5cbiAgICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKHRoaXMsICdDZXJ0aWZpY2F0ZScsIGNlcnRpZmljYXRlQXJuKVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIGRlZmF1bHRSb290T2JqZWN0OiAnaW5kZXguaHRtbCcsIC8vIOODh+ODleOCqeODq+ODiOODq+ODvOODiOOCquODluOCuOOCp+OCr+ODiOOCkuaMh+WumlxuICAgIH07XG5cbiAgICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24odGhpcywgJ0Rpc3RyaWJ1dGlvbicsIGRpc3RyaWJ1dGlvblByb3BzKTtcblxuICAgIC8vIE91dHB1dHMgZm9yIGZyb250LWVuZCBjb25maWd1cmF0aW9uXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7IHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7IHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0J1Y2tldE5hbWUnLCB7IHZhbHVlOiB0aGlzLmJ1Y2tldC5idWNrZXROYW1lIH0pO1xuICAgIC8vIGFsc28gb3V0cHV0IHRoZSBhc3NldCBidWNrZXQgYW5kIGRpc3RyaWJ1dGlvbiBkb21haW5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXNzZXRCdWNrZXROYW1lJywgeyB2YWx1ZTogYXNzZXRCdWNrZXQuYnVja2V0TmFtZSB9KTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGlzdHJpYnV0aW9uRG9tYWluJywgeyB2YWx1ZTogZGlzdHJpYnV0aW9uLmRvbWFpbk5hbWUgfSk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0lkZW50aXR5UG9vbElkJywgeyB2YWx1ZTogaWRlbnRpdHlQb29sLnJlZiB9KTtcbiAgICAvLyBvcHRpb25hbCBwcmVmaXggZXhwb3J0XG4gICAgaWYgKHByZWZpeCkge1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Jlc291cmNlUHJlZml4JywgeyB2YWx1ZTogcHJlZml4IH0pO1xuICAgIH1cbiAgfVxufVxuIl19