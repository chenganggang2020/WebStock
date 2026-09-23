package com.webstock.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReconnectPolicyTest {
    @Test
    public void reconnectsOnlyAfterARecoverableFailureWithSavedServer() {
        ReconnectPolicy policy = new ReconnectPolicy();
        policy.onStart();

        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onConnectionFailed(true, true));
        assertEquals(0L, policy.onNetworkAvailable());
        assertTrue(policy.consumeReconnect());

        policy.onConnectionSucceeded();
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onNetworkAvailable());
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onConnectionFailed(true, false));
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onConnectionFailed(false, true));
    }

    @Test
    public void neverReloadsANormalVisiblePage() {
        ReconnectPolicy policy = new ReconnectPolicy();
        policy.onStart();

        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onNetworkAvailable());
        policy.onConnectionSucceeded();
        policy.onNetworkUnavailable();
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onNetworkAvailable());
        assertFalse(policy.consumeReconnect());
    }

    @Test
    public void coalescesDuplicateCallbacksAndUsesFiniteBackoff() {
        ReconnectPolicy policy = new ReconnectPolicy();
        policy.onStart();
        policy.onNetworkAvailable();

        assertEquals(0L, policy.onConnectionFailed(true, true));
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onConnectionFailed(true, true));
        assertTrue(policy.consumeReconnect());

        assertEquals(2_000L, policy.onConnectionFailed(true, true));
        assertTrue(policy.consumeReconnect());
        assertEquals(5_000L, policy.onConnectionFailed(true, true));
        assertTrue(policy.consumeReconnect());
        assertEquals(15_000L, policy.onConnectionFailed(true, true));
        assertTrue(policy.consumeReconnect());
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onConnectionFailed(true, true));
        assertFalse(policy.consumeReconnect());
    }

    @Test
    public void networkLossAndBackgroundingCancelPendingReconnect() {
        ReconnectPolicy policy = new ReconnectPolicy();
        policy.onStart();
        policy.onNetworkAvailable();

        assertEquals(0L, policy.onConnectionFailed(true, true));
        policy.onNetworkUnavailable();
        assertFalse(policy.consumeReconnect());

        assertEquals(0L, policy.onNetworkAvailable());
        policy.onStop();
        assertFalse(policy.consumeReconnect());
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onNetworkAvailable());
    }

    @Test
    public void authenticationFailureIsNeverRetriedAutomatically() {
        ReconnectPolicy policy = new ReconnectPolicy();
        policy.onStart();
        policy.onNetworkAvailable();
        policy.onNonRetryableFailure();

        policy.onNetworkUnavailable();
        assertEquals(ReconnectPolicy.NO_RECONNECT, policy.onNetworkAvailable());
        assertFalse(policy.consumeReconnect());
    }
}
