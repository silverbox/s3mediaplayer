// jest doesn't understand CSS imports so stub them out
// depending on package exports Jest may not resolve the shorthand path,
// mock the actual distributed file instead
jest.mock('@aws-amplify/ui-react/dist/styles.css', () => '');

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { getUrl } from 'aws-amplify/storage';

// mock Storage.get to return a predictable URL
jest.mock('aws-amplify', () => {
  const actual = jest.requireActual('aws-amplify');
  return {
    ...actual,
    Storage: {
      get: jest.fn(() => Promise.resolve('https://example.com/test.mp3')),
    },
  };
});

describe('App', () => {
  beforeEach(() => {
    // fake the fetch call used in the effect to return folders + objects
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ folders: ['dir/'], objects: ['song.mp3', 'image.png'] }),
      })
    ) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('shows listed files and plays audio when mp3 clicked', async () => {
    render(<App />);

    // wait for the list item to appear
    const button = await screen.findByRole('button', { name: 'song.mp3' });
    expect(button).toBeInTheDocument();

    // and the folder name should be rendered
    const folder = await screen.findByText('dir/');
    expect(folder).toBeInTheDocument();

    // click it and verify Storage.get was called
    userEvent.click(button);

    await waitFor(() => {
      const audio = document.querySelector('audio');
      expect(audio).toBeInTheDocument();
      expect((audio as HTMLAudioElement).src).toBe('https://example.com/test.mp3');
    });
  });
});
