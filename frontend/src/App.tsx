import React, { useEffect, useState } from 'react';
import { Authenticator, ThemeProvider, View, Heading } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from '@aws-amplify/auth';
import './App.css';
import AWS from 'aws-sdk'

// placeholder config, to be replaced by generated values from CDK
// Amplify v6+ uses root-level `region`; Auth no longer accepts `region` property
// cast config to any because the TS definitions in aws-amplify v6+
// are intentionally strict and don't expose the legacy properties we need
// (userPoolId, userPoolWebClientId, etc.).
// The runtime still accepts the object shape used here.
Amplify.configure({
  // default region for all categories
  region: process.env.REACT_APP_AWS_REGION,

  Auth: {
    Cognito: {
      userPoolId: process.env.REACT_APP_USER_POOL_ID,
      userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
    },
  },
  Storage: {
    AWSS3: {
      bucket: process.env.REACT_APP_S3_BUCKET,
    },
  },
} as any);

function App() {
  const [files, setFiles] = useState<string[]>([]);
  // URL for the currently selected audio file (if any)
  const [audioUrl, setAudioUrl] = useState<string>('');

  // click handler that retrieves a signed URL and updates audioUrl
  const handlePlay = async (filename: string) => {
    try {
      const session = await fetchAuthSession();
      if (!session) {
        console.error('Session is not valid');
        return;
      }
      if (!session.tokens) {
        console.error('Session tokens are not available');
        return;
      }
      if (!session.tokens.idToken) {
        console.error('Session idToken is not available');
        return;
      }
      const idToken = session.tokens.idToken.toString();

      // `Storage.get` will automatically use the current credentials
      // (Cognito identity) to sign the request.  We ask for a URL rather
      // than downloading the file so the browser can stream it directly.
      const PROVIDER_KEY = 'cognito-idp.' + process.env.REACT_APP_AWS_REGION + '.amazonaws.com/' + process.env.REACT_APP_USER_POOL_ID
      AWS.config.region = process.env.REACT_APP_AWS_REGION
      const credentials = new AWS.CognitoIdentityCredentials({
        IdentityPoolId: process.env.REACT_APP_ID_POOL_ID || '',
        Logins: {
          [PROVIDER_KEY]: idToken
        }
      });
      AWS.config.credentials = credentials;
      // 有効期限チェック付きでrefresh
      if (credentials.needsRefresh()) {
        credentials.refresh((err) => {
          if (err) {
            console.error('認証エラー:', err);
            return;
          }
          processS3Request(credentials, filename);
        });
      } else {
        processS3Request(credentials, filename);
      }
    } catch (err) {
      console.error('failed to fetch playback URL', err);
    }
  };

  const processS3Request = (credentials: any, filename: string) => {
    if (!credentials.identityId) {
      console.error('Identity IDが利用できません');
      return;
    }
    const currentIdentityId = credentials.identityId;
    
    // filenameからIdentity IDを抽出して比較
    const filenameIdentityId = filename.split('/')[0];
    
    if (currentIdentityId !== filenameIdentityId) {
      console.error(`Identity IDが一致しません ${currentIdentityId} !== ${filenameIdentityId}`);
      return;
    }

    var s3 = new AWS.S3({
      params: { Bucket: process.env.REACT_APP_S3_BUCKET }
    });
    
    s3.getSignedUrl('getObject', { 
      Key: filename,
      Expires: 3600 
    }, function (err, url) {
      if (err) {
        console.error('署名付きURL生成エラー:', err);
      } else {
        setAudioUrl(url);
      }
    });
  };

  useEffect(() => {
    const apiUrl = process.env.REACT_APP_API_URL || '';

    // when the user is signed in Amplify stores their tokens;
    // we need to include an Authorization header so the API Gateway
    // authorizer can inject the Cognito identity claims into the
    // request context that your Lambda relies on.
    
    const fetchWithAuth = async () => {
      try {
        // get a valid session (refreshes if necessary)
        const session = await fetchAuthSession();
        if (!session) {
          console.error('Session is not valid');
          return;
        }
        if (!session.tokens) {
          console.error('Session tokens are not available');
          return;
        }
        if (!session.tokens.idToken) {
          console.error('Session idToken is not available');
          return;
        }
        const idToken = session.tokens.idToken.toString();

        const res = await fetch(apiUrl + '/', {
          headers: {
            Authorization: idToken,
          },
        });
        const data = await res.json();
        setFiles(data);
      } catch (err) {
        console.error('failed to list files', err);
      }
    };

    fetchWithAuth();
  }, []);

  return (
    <ThemeProvider>
      <Authenticator>
        {({ signOut, user }) => (
          <View className="App">
            <header className="App-header">
              <Heading level={3}>Welcome, {user?.username}</Heading>
              <button onClick={signOut}>Sign out</button>
            </header>
            <main>
              {/* TODO: display files and upload/download UI */}
              <section>
                        <h4>Your files</h4>
                {files.length === 0 ? (
                  <p>No files found</p>
                ) : (
                  <ul>
                    {files.map((f) => {
                      const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(f);
                      return (
                        <li key={f}>
                          {isAudio ? (
                            <button
                              className="file-button"
                              onClick={() => handlePlay(f)}
                            >
                              {f}
                            </button>
                          ) : (
                            f
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {/* audio player section */}
                {audioUrl && (
                  <div className="audio-player">
                    <audio controls autoPlay src={audioUrl}>
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
              </section>
            </main>
          </View>
        )}
      </Authenticator>
    </ThemeProvider>
  );
}

export default App;
