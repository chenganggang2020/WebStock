package com.webstock.companion;

/** Main-thread state machine for bounded reconnects after a visible connection failure. */
public final class ReconnectPolicy {
    public static final long NO_RECONNECT = -1L;
    private static final long[] RETRY_DELAYS_MS = {0L, 2_000L, 5_000L, 15_000L};

    private boolean foreground;
    private boolean networkAvailable;
    private boolean retryableFailure;
    private boolean reconnectPending;
    private int retryIndex;

    public void onStart() {
        foreground = true;
    }

    public void onStop() {
        foreground = false;
        networkAvailable = false;
        reconnectPending = false;
    }

    public long onNetworkAvailable() {
        if (!foreground || networkAvailable) return NO_RECONNECT;
        networkAvailable = true;
        return scheduleNextIfNeeded();
    }

    public void onNetworkUnavailable() {
        networkAvailable = false;
        reconnectPending = false;
        retryIndex = 0;
    }

    public long onConnectionFailed(boolean hasServerUrl, boolean connectionPanelVisible) {
        retryableFailure = hasServerUrl && connectionPanelVisible;
        if (!retryableFailure) {
            reconnectPending = false;
            retryIndex = 0;
            return NO_RECONNECT;
        }
        return scheduleNextIfNeeded();
    }

    public void onManualAttempt() {
        retryableFailure = false;
        reconnectPending = false;
        retryIndex = 0;
    }

    public void onConnectionSucceeded() {
        onManualAttempt();
    }

    public void onNonRetryableFailure() {
        onManualAttempt();
    }

    public boolean consumeReconnect() {
        if (!foreground || !networkAvailable || !retryableFailure || !reconnectPending) {
            reconnectPending = false;
            return false;
        }
        reconnectPending = false;
        return true;
    }

    private long scheduleNextIfNeeded() {
        if (!foreground || !networkAvailable || !retryableFailure || reconnectPending ||
            retryIndex >= RETRY_DELAYS_MS.length) {
            return NO_RECONNECT;
        }
        reconnectPending = true;
        return RETRY_DELAYS_MS[retryIndex++];
    }
}
