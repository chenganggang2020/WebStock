package com.webstock.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SnapshotChangeTest {
    private static String snapshot(int observations, double assets) {
        return "{\"schema\":\"webstock.mobile-snapshot/v1\",\"generatedAt\":\"2026-08-13T01:30:00.000Z\"," +
            "\"accounts\":[{\"id\":1,\"summary\":{\"totalAssets\":" + assets + "}}]," +
            "\"research\":{\"totals\":{\"observationCount\":" + observations + "}}}";
    }

    @Test
    public void reportsNewResearchWithoutPuttingPortfolioValuesInNotificationText() {
        SnapshotChange change = SnapshotChange.between(snapshot(380, 10000), snapshot(383, 12000));
        assertTrue(change.shouldNotify());
        assertEquals(3, change.newResearchCount);
        assertEquals("新增研究资料 3 条，账户快照已刷新", change.message());
        assertFalse(change.message().contains("12000"));
    }

    @Test
    public void firstSyncAndTimestampOnlyRefreshesStayQuiet() {
        assertFalse(SnapshotChange.between("", snapshot(380, 10000)).shouldNotify());
        assertFalse(SnapshotChange.between(snapshot(380, 10000), snapshot(380, 10000)).shouldNotify());
        assertFalse(SnapshotChange.between(snapshot(380, 10000), snapshot(380, 10100)).shouldNotify());
    }

    @Test
    public void materialAccountRefreshCanNotifyWithoutSensitiveNumbers() {
        SnapshotChange change = SnapshotChange.between(snapshot(380, 10000), snapshot(380, 10400));
        assertTrue(change.shouldNotify());
        assertEquals("账户快照已刷新，请打开 WebStock 查看", change.message());
    }
}
