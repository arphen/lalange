import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Research } from './Research';

describe('Research', () => {
  it('keeps every section discoverable while showing the selected panel', () => {
    render(
      <MemoryRouter>
        <Research />
      </MemoryRouter>,
    );

    const introduction = screen.getByRole('heading', { name: '1. The Neuro-Semantic Intervention' });
    const librarian = screen.getByRole('heading', { name: '5. The Librarian', hidden: true });

    expect(introduction).toBeVisible();
    expect(librarian).not.toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '05. The Librarian' }));

    expect(introduction).not.toBeVisible();
    expect(librarian).toBeVisible();
  });
});