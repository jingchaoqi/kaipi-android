package dev.kaipi.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class TurnActivityTest {
    @Test public void lateAcceptanceCannotReviveATerminalTurn() {
        TurnActivity state = new TurnActivity();
        state.requested("1"); assertTrue(state.isRunning());
        state.started(); state.settled(false);
        state.response("1", true);
        assertFalse(state.isRunning());
    }
    @Test public void acceptanceBeforeStartAndRejectionAreHandled() {
        TurnActivity state = new TurnActivity();
        state.requested("1"); state.response("1", false);
        assertFalse(state.isRunning());
        state.requested("2"); state.response("2", true);
        assertTrue(state.isRunning());
        state.requested("3"); state.response("3", false);
        assertTrue(state.isRunning());
        state.settled(false); assertFalse(state.isRunning());
    }
    @Test public void reconnectRestoresActivityWithoutRetainingAnOldRequest() {
        TurnActivity state = new TurnActivity();
        state.requested("old"); state.settled(false);
        state.settled(true); assertTrue(state.isRunning());
        state.settled(false); state.response("old", true);
        assertFalse(state.isRunning());
    }
}
