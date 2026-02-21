import React, { useEffect, useState } from 'react';
import { Authenticator, ThemeProvider, View, Heading } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from '@aws-amplify/auth';
import './App.css';

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
      region: process.env.REACT_APP_AWS_REGION,
      userPoolId: process.env.REACT_APP_USER_POOL_ID,
      userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
    },
  },
  Storage: {
    AWSS3: {
      bucket: process.env.REACT_APP_S3_BUCKET,
      region: process.env.REACT_APP_AWS_REGION,
    },
  },
} as any);

function App() {
  const [files, setFiles] = useState<string[]>([]);

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
                    {files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
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
