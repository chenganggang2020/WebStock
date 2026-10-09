package com.webstock.companion;

import org.junit.Test;
import static org.junit.Assert.*;

public class StandaloneRequestsTest {
    @Test public void localStateDoesNotWaitBehindNetworkWork() {
        assertTrue(StandaloneRequests.isLocal("/state"));
        assertTrue(StandaloneRequests.isLocal("/record"));
        assertTrue(StandaloneRequests.isLocal("/chart-cache?code=600000&type=kline&period=day"));
        assertFalse(StandaloneRequests.isLocal("/kline?code=600000"));
        assertFalse(StandaloneRequests.isLocal("/quotes?symbols=sh600000"));
        assertFalse(StandaloneRequests.isLocal("/ai"));
        assertFalse(StandaloneRequests.isLocal("https://example.com/state"));
    }
}
