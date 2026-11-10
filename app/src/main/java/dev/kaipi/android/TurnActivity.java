package dev.kaipi.android;

import java.util.HashSet;
import java.util.Set;

/** Platform activity only; core owns execution and terminal outcomes. */
final class TurnActivity {
    private boolean running;
    private final Set<String> pending = new HashSet<>();

    synchronized void requested(String id) { pending.add(id); }
    synchronized void response(String id, boolean accepted) {
        // A terminal event can precede its RPC acknowledgement.
        if (pending.remove(id) && accepted) running = true;
    }
    synchronized void started() { running = true; }
    synchronized void settled(boolean busy) { pending.clear(); running = busy; }
    synchronized boolean isRunning() { return running || !pending.isEmpty(); }
}
