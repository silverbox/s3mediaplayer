const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const cognitoIdentity = new AWS.CognitoIdentity();

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Headers" : "Content-Type,Authorization",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
  };
  // This lambda would list objects in the user's folder.
  // The 'sub' could be obtained from Cognito Identity claims.
  const userId = event.requestContext.authorizer?.claims?.sub;

  // ID Tokenを取得（オーサライザーから）
  const idToken = event.requestContext.authorizer?.claims?.token_use === 'id' 
      ? event.headers.Authorization?.replace('Bearer ', '')
      : null;

  if (!idToken) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: `ID token not found ${userId}` }),
      headers: corsHeaders
    };
  }
  // Identity Pool IDを取得
  const identityId = await getIdentityId(idToken);
        
  const bucket = process.env.BUCKET;

  if (!identityId) {
    return { statusCode: 400,
      body: 'Missing identity ID',
      headers: corsHeaders
    };
  }
  const basePrefix = `${identityId}/`;
  const params = {
    Bucket: bucket,
    Prefix: basePrefix,
    Delimiter: '/',       // only list immediate children
  };
  const data = await s3.listObjectsV2(params).promise();

  // folders are returned in CommonPrefixes
  const folders = (data.CommonPrefixes || []).map(cp => {
    // leave as-is; clients may want the full prefix (e.g. "identityId/folder/")
    return cp.Prefix;
  });

  // objects are in Contents; filter out the folder placeholder if any
  const objects = (data.Contents || [])
    .filter(o => o.Key !== basePrefix)
    .map(o => o.Key); // keep full key so clients can use it directly

  return { 
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ folders, objects })
  };
};

async function getIdentityId(idToken) {
    const params = {
        IdentityPoolId: process.env.IDENTITY_POOL_ID,
        Logins: {
            [`cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`]: idToken
        }
    };
    
    const result = await cognitoIdentity.getId(params).promise();
    return result.IdentityId;
}
