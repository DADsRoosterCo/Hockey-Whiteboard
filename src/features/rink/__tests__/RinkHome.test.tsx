import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RinkHome } from '@/app/_components/rink-home'

describe('RinkHome UI - add/remove players', () => {
  it('allows removing all actors and then adding a player back', async () => {
    render(<RinkHome />)
    const user = userEvent.setup()

    // Initially there are two players; remove twice to empty
    const removeBtn = await screen.findByRole('button', { name: /Remove Player/i })
    await user.click(removeBtn)
    // There should still be a Remove Player button for the second actor
    await user.click(await screen.findByRole('button', { name: /Remove Player/i }))

    // Now empty-state UI should show Add Player
    const addBtn = await screen.findByRole('button', { name: /Add Player/i })
    expect(addBtn).toBeTruthy()

    // Click add and ensure active player select appears
    await user.click(addBtn)
    const activeSelect = await screen.findByLabelText(/Switch active player/i)
    expect(activeSelect).toBeTruthy()
  })
})
