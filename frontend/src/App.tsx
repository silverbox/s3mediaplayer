import React, { useEffect, useState } from 'react';
import { Authenticator, ThemeProvider, View, Heading } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import Amplify from 'aws-amplify';
import './App.css';

// placeholder config, to be replaced by generated values from CDK
Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_AWS_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
  },
  Storage: {
    AWSS3: {
      bucket: process.env.REACT_APP_S3_BUCKET,
      region: process.env.REACT_APP_AWS_REGION,
    },
  },
});

function App() {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    const apiUrl = process.env.REACT_APP_API_URL || '';
    fetch(apiUrl + '/')
      .then((res) => res.json())
      .then((data) => {
        setFiles(data);
      })
      .catch((err) => {
        console.error('failed to list files', err);
      });
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
