package ro.purgo.android;

import org.json.JSONObject;

/** A long-running native task that can report progress and be cancelled from the UI. */
abstract class Job {
    volatile boolean cancelled;
    private long lastTick;

    abstract void emit(JSONObject progress);

    /** Throttled progress (at most ~8 updates per second unless forced). */
    void progress(boolean force, Object... kv) {
        long now = System.currentTimeMillis();
        if (!force && now - lastTick < 120) return;
        lastTick = now;
        emit(Util.obj(kv));
    }
}
