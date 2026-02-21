// jest doesn't understand CSS imports so stub them out
jest.mock('@aws-amplify/ui-react/styles.css', () => '');

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
    // fake the fetch call used in the effect
    global.fetch = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(['song.mp3', 'image.png']) })
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

    // click it and verify Storage.get was called
    userEvent.click(button);

    await waitFor(() => {
      const audio = document.querySelector('audio');
      expect(audio).toBeInTheDocument();
      expect((audio as HTMLAudioElement).src).toBe('https://example.com/test.mp3');
    });
  });
});
