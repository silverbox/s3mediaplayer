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

const getIdToken = async (): Promise<string | null> => {
  try {
    const session = await fetchAuthSession();
    if (!session) {
      console.error('Session is not valid');
      return null;
    }
    if (!session.tokens) {
      console.error('Session tokens are not available');
      return null;
    }
    if (!session.tokens.idToken) {
      console.error('Session idToken is not available');
      return null;
    }
    return session.tokens.idToken.toString();
  } catch (err) {
    console.error('failed to get ID token', err);
    return null;
  }
};

interface AuthenticatedContentProps {
  signOut?: (data?: any) => void;
  user: any;
}

function AuthenticatedContent({ signOut, user }: AuthenticatedContentProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  // current folder relative to the user's identity (e.g. "" or "music/" or "music/album/")
  const [currentFolder, setCurrentFolder] = useState<string>('');
  // currently playing filename (from the files list)
  const [currentFile, setCurrentFile] = useState<string>('');
  // URL for the currently selected audio file (if any)
  const [audioUrl, setAudioUrl] = useState<string>('');

  // click handler that retrieves a signed URL and updates audioUrl
  const handlePlay = async (filename: string) => {
    setCurrentFile(filename);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        console.error('ID token is not available');
        return;
      }

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

  const playRandom = () => {
    if (files.length === 0) {
      return;
    }
    // choose a random file different from current if possible
    let choice = currentFile;
    if (files.length > 1) {
      while (choice === currentFile) {
        choice = files[Math.floor(Math.random() * files.length)];
      }
    }
    handlePlay(choice);
  };

  const processS3Request = (credentials: any, filename: string) => {
    if (!credentials.identityId) {
      console.error('Identity IDが利用できません');
      return;
    }
    const currentIdentityId = credentials.identityId;
    // build the S3 key using the identityId + currentFolder + filename
    const keyPrefix = currentFolder ? `${currentFolder}` : '';
    const key = `${currentIdentityId}/${keyPrefix}${filename}`;

    var s3 = new AWS.S3({ params: { Bucket: process.env.REACT_APP_S3_BUCKET } });

    s3.getSignedUrl('getObject', {
      Key: key,
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

    const fetchWithAuth = async () => {
      try {
        const idToken = await getIdToken();
        if (!idToken) {
          console.error('ID token is not available');
          return;
        }

        // include optional prefix query param to request a subfolder
        const prefixParam = currentFolder ? `?prefix=${encodeURIComponent(currentFolder)}` : '';
        const res = await fetch(apiUrl + '/list' + prefixParam, {
          headers: { Authorization: idToken },
        });
        const data = await res.json();

        if (data && typeof data === 'object') {
          setFolders(Array.isArray(data.folders) ? data.folders : []);
          setFiles(Array.isArray(data.objects) ? data.objects : []);
        } else {
          setFiles(Array.isArray(data) ? data : []);
          setFolders([]);
        }
      } catch (err) {
        console.error('failed to list files', err);
      }
    };

    fetchWithAuth();
  }, [currentFolder, user]);

  const handleFolderClick = (folder: string) => {
    // folder usually ends with '/'
    setCurrentFolder((prev) => `${prev || ''}${folder}`);
  };

  const goUp = () => {
    if (!currentFolder) return;
    // remove trailing slash then drop last segment
    const trimmed = currentFolder.replace(/\/+$/, '');
    const parts = trimmed.split('/');
    parts.pop();
    const next = parts.length > 0 ? parts.join('/') + '/' : '';
    setCurrentFolder(next);
  };

  return (
    <View className="App">
      <header className="App-header">
        <Heading level={3}>Welcome, {user?.username}</Heading>
        <button onClick={() => signOut?.()}>Sign out</button>
      </header>
      <main>
        {/* TODO: display files and upload/download UI */}
        <section>
          <h4>Your folders</h4>
          <div className="folder-header">
            <strong>Current:</strong> {currentFolder || 'root'}
            {currentFolder && (
              <button className="up-button" onClick={goUp} style={{marginLeft:8}}>Up</button>
            )}
          </div>
          {folders.length === 0 ? (
            <p>No folders found</p>
          ) : (
            <ul>
              {folders.map((d) => (
                <li key={d}>
                  <button className="folder-button" onClick={() => handleFolderClick(d)}>{d}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

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
              <audio controls autoPlay src={audioUrl} onEnded={playRandom}>
                Your browser does not support the audio element.
              </audio>
            </div>
          )}
        </section>
      </main>
    </View>
  );
}

function App() {
  return (
    <ThemeProvider>
      {/* signup disabled since Cognito self‑sign‑up is turned off */}
      <Authenticator hideSignUp>
        {({ signOut, user }) => (
          <AuthenticatedContent signOut={signOut} user={user} />
        )}
      </Authenticator>
    </ThemeProvider>
  );
}

export default App;
